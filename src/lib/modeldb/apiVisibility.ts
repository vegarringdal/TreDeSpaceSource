// Visibility domain: hide/isolate/unhide. Every op is a step on the shared
// STATE undo stack (owned by apiColor — hidden/color/opacity are one band),
// so the ribbon Undo reverts hides exactly like colorings.
import { quatAxes } from '../math/quat';
import { type ColorUndoRecord, captureColorRuns, pushColorUndo } from './colorUndo';
import { type DbModel, IS_HIDDEN, models, type StateUpdate } from './dbState';
import { packStates } from './hierarchyIndex';
import { itemWorldBounds, transforms } from './transformPool';

export const visibilityApi = {
  /** Union AABB + fraction of the NON-hidden items per model — the residency
   * manager's hidden-aware priority input. Uses WORLD-space (transformed)
   * item boxes, so a moved model is budgeted where it actually is. bounds is
   * null when every item with geometry is hidden (such a model deserves no
   * VRAM). */
  visibleBounds(
    indices: number[],
    eye: readonly [number, number, number],
  ): { model: number; bounds: number[] | null; dense: number[] | null; visibleFrac: number; nearestDist: number }[] {
    const wb = new Float32Array(6);
    return indices.map((idx) => {
      const m = models[idx];
      if (!m || m.removed) {
        return { model: idx, bounds: null, dense: null, visibleFrac: 0, nearestDist: Infinity };
      }
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      let total = 0;
      let visible = 0;
      let nearestSq = Infinity;
      // running mean/variance of item centres — the DENSE box (mean ± 2σ) is
      // what residency decisions use, so one outlier item cannot inflate a
      // zone until it swallows the camera / frustum / clip volume
      let n = 0;
      const mean = [0, 0, 0];
      const m2 = [0, 0, 0];
      let halfSum = 0;
      for (let i = 0; i < m.itemCount; i++) {
        if (!itemWorldBounds(m.itemBounds, m.tidx, i, wb)) {
          continue; // item without geometry
        }
        total++;
        if (m.states[i * 2] & IS_HIDDEN) {
          continue;
        }
        visible++;
        let dsq = 0;
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], wb[k]);
          max[k] = Math.max(max[k], wb[k + 3]);
          const c = Math.min(Math.max(eye[k], wb[k]), wb[k + 3]);
          dsq += (eye[k] - c) ** 2;
        }
        if (dsq < nearestSq) {
          nearestSq = dsq;
        }
        n++;
        for (let k = 0; k < 3; k++) {
          const c = (wb[k] + wb[k + 3]) / 2;
          const d = c - mean[k];
          mean[k] += d / n;
          m2[k] += d * (c - mean[k]);
          halfSum += (wb[k + 3] - wb[k]) / 6; // average half-extent per axis
        }
      }
      let dense: number[] | null = null;
      if (visible > 0) {
        const pad = halfSum / Math.max(1, n);
        dense = [0, 0, 0, 0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const sd = n > 1 ? Math.sqrt(m2[k] / (n - 1)) : 0;
          dense[k] = Math.max(min[k], mean[k] - 2 * sd - pad);
          dense[k + 3] = Math.min(max[k], mean[k] + 2 * sd + pad);
        }
      }
      return {
        model: idx,
        bounds: visible > 0 ? [...min, ...max] : null,
        dense,
        visibleFrac: total > 0 ? visible / total : 0,
        // distance to the NEAREST visible item, not to the union box: one
        // outlier item must not make a distant zone look adjacent
        nearestDist: Math.sqrt(nearestSq),
      };
    });
  },

  /** Hide every selected item (undoable, state domain). */
  hideSelection(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      if (m.selected.length === 0) {
        return;
      }
      step.push(captureColorRuns(idx));
      for (const it of m.selected) {
        m.states[it * 2] |= IS_HIDDEN;
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },

  /** Isolate: hide everything that is NOT selected. */
  isolateSelection(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      step.push(captureColorRuns(idx));
      const sel = new Uint8Array(m.itemCount);
      for (const it of m.selected) {
        sel[it] = 1;
      }
      for (let i = 0; i < m.itemCount; i++) {
        if (sel[i]) {
          m.states[i * 2] &= ~IS_HIDDEN;
        } else {
          m.states[i * 2] |= IS_HIDDEN;
        }
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },

  unhideSelection(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      if (m.selected.length === 0) {
        return;
      }
      step.push(captureColorRuns(idx));
      for (const it of m.selected) {
        m.states[it * 2] &= ~IS_HIDDEN;
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },

  /** Unhide every HIDDEN item whose world AABB (transform-aware, same corner
   *  logic as selectionBounds) intersects the given oriented box. The test
   *  maps the corners into box space and compares their AABB against the box
   *  half-extents — exact for axis-aligned boxes, slightly conservative for
   *  rotated ones (may unhide a few extra items near corners). */
  unhideIntersecting(box: {
    center: [number, number, number];
    size: [number, number, number];
    rotation: [number, number, number, number];
  }): StateUpdate[] {
    const axes = quatAxes(box.rotation);
    const half = [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2];
    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      // captured BEFORE mutation; only kept if something actually changed
      const rec = captureColorRuns(idx);
      let changed = false;
      for (let i = 0; i < m.itemCount; i++) {
        if (!(m.states[i * 2] & IS_HIDDEN)) {
          continue;
        }
        const b = i * 6;
        if (!Number.isFinite(m.itemBounds[b])) {
          continue;
        }
        const slot = m.tidx[i];
        const t = slot === 0 ? null : transforms.subarray(slot * 16, slot * 16 + 16);
        const lmin = [Infinity, Infinity, Infinity];
        const lmax = [-Infinity, -Infinity, -Infinity];
        for (let corner = 0; corner < 8; corner++) {
          let x = m.itemBounds[b + (corner & 1 ? 3 : 0)];
          let y = m.itemBounds[b + 1 + (corner & 2 ? 3 : 0)];
          let z = m.itemBounds[b + 2 + (corner & 4 ? 3 : 0)];
          if (t) {
            const wx = t[0] * x + t[4] * y + t[8] * z + t[12];
            const wy = t[1] * x + t[5] * y + t[9] * z + t[13];
            const wz = t[2] * x + t[6] * y + t[10] * z + t[14];
            x = wx;
            y = wy;
            z = wz;
          }
          const dx = x - box.center[0];
          const dy = y - box.center[1];
          const dz = z - box.center[2];
          for (let a = 0; a < 3; a++) {
            const l = dx * axes[a][0] + dy * axes[a][1] + dz * axes[a][2];
            if (l < lmin[a]) {
              lmin[a] = l;
            }
            if (l > lmax[a]) {
              lmax[a] = l;
            }
          }
        }
        if (
          lmin[0] <= half[0] &&
          lmax[0] >= -half[0] &&
          lmin[1] <= half[1] &&
          lmax[1] >= -half[1] &&
          lmin[2] <= half[2] &&
          lmax[2] >= -half[2]
        ) {
          m.states[i * 2] &= ~IS_HIDDEN;
          changed = true;
        }
      }
      if (changed) {
        step.push(rec);
        updates.push(packStates(m, idx));
      }
    });
    pushColorUndo(step);
    return updates;
  },

  /** Unhide every hidden item whose world AABB intersects ANY selected item's
   *  world AABB grown by `margin` on all sides — the per-item version of
   *  unhideIntersecting (each selected LEAF item spans its own little box).
   *  The caller guards the selection size (per-item boxes × all items). */
  unhideAroundSelectedItems(margin: number): StateUpdate[] {
    // world AABB of one item (transform-aware corners), packed min×3+max×3
    const worldAabb = (m: DbModel, i: number): number[] | null => {
      const b = i * 6;
      if (!Number.isFinite(m.itemBounds[b])) {
        return null;
      }
      const slot = m.tidx[i];
      if (slot === 0) {
        return [
          m.itemBounds[b],
          m.itemBounds[b + 1],
          m.itemBounds[b + 2],
          m.itemBounds[b + 3],
          m.itemBounds[b + 4],
          m.itemBounds[b + 5],
        ];
      }
      const t = transforms.subarray(slot * 16, slot * 16 + 16);
      const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let corner = 0; corner < 8; corner++) {
        const x = m.itemBounds[b + (corner & 1 ? 3 : 0)];
        const y = m.itemBounds[b + 1 + (corner & 2 ? 3 : 0)];
        const z = m.itemBounds[b + 2 + (corner & 4 ? 3 : 0)];
        const p = [
          t[0] * x + t[4] * y + t[8] * z + t[12],
          t[1] * x + t[5] * y + t[9] * z + t[13],
          t[2] * x + t[6] * y + t[10] * z + t[14],
        ];
        for (let a = 0; a < 3; a++) {
          if (p[a] < out[a]) {
            out[a] = p[a];
          }
          if (p[a] > out[3 + a]) {
            out[3 + a] = p[a];
          }
        }
      }
      return out;
    };

    const boxes: number[][] = [];
    for (const m of models) {
      if (m.removed) {
        continue;
      }
      for (const it of m.selected) {
        const w = worldAabb(m, it);
        if (!w) {
          continue;
        }
        boxes.push([w[0] - margin, w[1] - margin, w[2] - margin, w[3] + margin, w[4] + margin, w[5] + margin]);
      }
    }
    if (boxes.length === 0) {
      return [];
    }

    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      // captured BEFORE mutation; only kept if something actually changed
      const rec = captureColorRuns(idx);
      let changed = false;
      for (let i = 0; i < m.itemCount; i++) {
        if (!(m.states[i * 2] & IS_HIDDEN)) {
          continue;
        }
        const w = worldAabb(m, i);
        if (!w) {
          continue;
        }
        for (const bx of boxes) {
          if (w[0] <= bx[3] && w[3] >= bx[0] && w[1] <= bx[4] && w[4] >= bx[1] && w[2] <= bx[5] && w[5] >= bx[2]) {
            m.states[i * 2] &= ~IS_HIDDEN;
            changed = true;
            break;
          }
        }
      }
      if (changed) {
        step.push(rec);
        updates.push(packStates(m, idx));
      }
    });
    pushColorUndo(step);
    return updates;
  },

  unhideAll(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      let any = false;
      for (let i = 0; i < m.itemCount; i++) {
        if (m.states[i * 2] & IS_HIDDEN) {
          any = true;
          break;
        }
      }
      if (!any) {
        return;
      }
      step.push(captureColorRuns(idx));
      for (let i = 0; i < m.itemCount; i++) {
        m.states[i * 2] &= ~IS_HIDDEN;
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },
};
