// -----------------------------------------------------------------------------
// transforms (port of native bake_selection_transform)
// -----------------------------------------------------------------------------
// Each op composes a GROUP matrix onto the selection: items are grouped by
// their current committed slot so every distinct base reuses one new slot
// (new = group * old). Undoable on the TRANSFORM stack (per-domain — this
// module owns that stack; there is no global undo).
import { type M4, m4AboutPoint, m4AxisRotate, m4AxisScale, m4Identity, m4Mul, m4Translate } from '../math/m4';
import { selectionApi } from './apiSelection';
import { models, type StateUpdate } from './dbState';
import { packStates } from './hierarchyIndex';
import { allocTransformSlot, transforms, transformsSnapshot } from './transformPool';

/** One undo RECORD per model: the whole per-item slot band as drawrange-style
 *  RLE runs — u32 triples [start, count, slot]. Group transforms give every
 *  distinct base ONE shared slot, so runs are naturally few: a whole model
 *  moved as one group is one run (12 bytes), not 8 bytes × items. */
interface TransformUndoRecord {
  model: number;
  runs: Uint32Array;
}
type TransformUndoStep = TransformUndoRecord[];
const transformUndo: TransformUndoStep[] = [];
const transformRedo: TransformUndoStep[] = [];
const TRANSFORM_UNDO_MAX_BYTES = 64 << 20; // cap by memory, not count (per stack)
let transformUndoBytes = 0;
let transformRedoBytes = 0;

const transformStepBytes = (step: TransformUndoStep): number => step.reduce((n, r) => n + r.runs.byteLength, 0);

/** Evict WHOLE oldest steps until the stack fits the cap — an old action never
 *  becomes partially undoable, and the newest step is never evicted. */
function evictTransformSteps(stack: TransformUndoStep[], bytes: number): number {
  let b = bytes;
  while (b > TRANSFORM_UNDO_MAX_BYTES && stack.length > 1) {
    b -= transformStepBytes(stack.shift()!);
  }
  return b;
}

function pushTransformUndo(step: TransformUndoStep) {
  if (step.length === 0) {
    return;
  }
  transformRedo.length = 0; // a fresh edit invalidates the redo branch
  transformRedoBytes = 0;
  transformUndo.push(step);
  transformUndoBytes = evictTransformSteps(transformUndo, transformUndoBytes + transformStepBytes(step));
}

/** RLE-capture one model's whole transform-slot band. */
function captureTransformRuns(model: number): TransformUndoRecord {
  const m = models[model];
  const runs: number[] = [];
  if (m.itemCount > 0) {
    let start = 0;
    let slot = m.tidx[0];
    for (let i = 1; i < m.itemCount; i++) {
      if (m.tidx[i] !== slot) {
        runs.push(start, i - start, slot);
        start = i;
        slot = m.tidx[i];
      }
    }
    runs.push(start, m.itemCount - start, slot);
  }
  return { model, runs: Uint32Array.from(runs) };
}

function restoreTransformRuns(rec: TransformUndoRecord) {
  const m = models[rec.model];
  const runs = rec.runs;
  for (let r = 0; r < runs.length; r += 3) {
    m.tidx.fill(runs[r + 2], runs[r], runs[r] + runs[r + 1]);
  }
}

/** Drop both transform-undo stacks (clear / snapshot REPLACE-import). */
export function resetTransformUndo(): void {
  transformUndo.length = 0;
  transformRedo.length = 0;
  transformUndoBytes = 0;
  transformRedoBytes = 0;
}

export const transformApi = {
  /** Nudge the selection. move: `amount` meters along world axis. rotate:
   * `amount` degrees around the world axis through the selection center.
   * scale-uniform: grow/shrink so the selection's largest dimension changes
   * by `amount` meters. scale: `amount` percent along one axis. All about
   * the selection center. */
  transformSelection(
    kind: 'move' | 'rotate' | 'scale' | 'scale-uniform',
    axis: 0 | 1 | 2,
    dir: 1 | -1,
    amount: number,
    pivot?: [number, number, number] | null,
  ): { updates: StateUpdate[]; transforms: Float32Array } {
    const a: [number, number, number] = [0, 0, 0];
    a[axis] = 1;
    let group: M4;
    if (kind === 'move') {
      group = m4Translate(a[0] * dir * amount, a[1] * dir * amount, a[2] * dir * amount);
    } else {
      // rotate/scale act about the locked custom pivot when given, else the
      // selection center
      const b = selectionApi.selectionBounds();
      const c: [number, number, number] =
        pivot ?? (b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : [0, 0, 0]);
      let local: M4;
      if (kind === 'rotate') {
        local = m4AxisRotate(a, (dir * amount * Math.PI) / 180);
      } else if (kind === 'scale-uniform') {
        // step is in meters: the largest selection dimension grows/shrinks
        // by `amount` (never collapsing below 1% of its size)
        const maxDim = b ? Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1e-3) : 1;
        const f = Math.max(0.01, (maxDim + dir * amount) / maxDim);
        local = m4Identity();
        local[0] = local[5] = local[10] = f;
      } else {
        local = m4AxisScale(a, dir > 0 ? 1 + amount / 100 : 1 / (1 + amount / 100));
      }
      group = m4AboutPoint(local, c);
    }
    return transformApi.applyGroupTransform(group);
  },

  /** Bake `group * old` into new slots for every selected item. */
  applyGroupTransform(group: M4): { updates: StateUpdate[]; transforms: Float32Array } {
    const updates: StateUpdate[] = [];
    const step: TransformUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      if (m.selected.length === 0) {
        return;
      }
      step.push(captureTransformRuns(idx));
      // group items by their current slot; each distinct base gets one new slot
      const bySlot = new Map<number, number[]>();
      for (const it of m.selected) {
        const s = m.tidx[it];
        const list = bySlot.get(s);
        if (list) {
          list.push(it);
        } else {
          bySlot.set(s, [it]);
        }
      }
      for (const [oldSlot, list] of bySlot) {
        const old = oldSlot === 0 ? m4Identity() : transforms.slice(oldSlot * 16, oldSlot * 16 + 16);
        const slot = allocTransformSlot();
        transforms.set(m4Mul(group, old), slot * 16);
        for (const it of list) {
          m.tidx[it] = slot;
        }
      }
      updates.push(packStates(m, idx));
    });
    pushTransformUndo(step);
    return { updates, transforms: transformsSnapshot() };
  },

  /** Reset the selection's transforms to identity (undoable). */
  resetTransformOnSelection(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    const step: TransformUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      if (m.selected.length === 0) {
        return;
      }
      step.push(captureTransformRuns(idx));
      for (const it of m.selected) {
        m.tidx[it] = 0;
      }
      updates.push(packStates(m, idx));
    });
    pushTransformUndo(step);
    return updates;
  },

  /** Reset every transform everywhere (undoable, transform domain). */
  resetAllTransforms(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    const step: TransformUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      let any = false;
      for (let i = 0; i < m.itemCount; i++) {
        if (m.tidx[i] !== 0) {
          any = true;
          break;
        }
      }
      if (!any) {
        return;
      }
      step.push(captureTransformRuns(idx));
      m.tidx.fill(0);
      updates.push(packStates(m, idx));
    });
    pushTransformUndo(step);
    return updates;
  },

  undoTransform(): StateUpdate[] {
    const step = transformUndo.pop();
    if (!step) {
      return [];
    }
    transformUndoBytes -= transformStepBytes(step);
    // records are one-per-model full-band captures, so the inverse is simply
    // a fresh capture of each model in the step
    const inverse = step.map((r) => captureTransformRuns(r.model));
    transformRedo.push(inverse);
    transformRedoBytes = evictTransformSteps(transformRedo, transformRedoBytes + transformStepBytes(inverse));
    for (const rec of step) {
      restoreTransformRuns(rec);
    }
    return step.map((r) => packStates(models[r.model], r.model));
  },

  redoTransform(): StateUpdate[] {
    const step = transformRedo.pop();
    if (!step) {
      return [];
    }
    transformRedoBytes -= transformStepBytes(step);
    // push the inverse back onto undo WITHOUT clearing redo
    const inverse = step.map((r) => captureTransformRuns(r.model));
    transformUndo.push(inverse);
    transformUndoBytes = evictTransformSteps(transformUndo, transformUndoBytes + transformStepBytes(inverse));
    for (const rec of step) {
      restoreTransformRuns(rec);
    }
    return step.map((r) => packStates(models[r.model], r.model));
  },

  transformUndoDepth(): number {
    return transformUndo.length;
  },

  transformRedoDepth(): number {
    return transformRedo.length;
  },
};
