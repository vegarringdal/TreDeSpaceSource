import { dialogs } from '../../components/dialogs/dialogs.actions';
import { consoleActions } from '../../components/panels/console/console.actions';
import { ribbonClippingBoxState } from '../../components/panels/ribbon-clipping-box/ribbonClippingBox.state';
import { downloadText } from '../../lib/download';
import { projectToScreen } from '../../lib/math/project';
import { quatAxes } from '../../lib/math/quat';
import { clipShapesState } from './clipShapes.state';
import { db } from './db';
import { LABEL_UNDO_MAX, type LabelsState, labelsState, MAX_LABELS, type SceneLabel } from './labels.state';
import { loadedIndicesForStore } from './storeScope';
import { getRenderer } from './viewer.actions';

let nextId = 1;

type P3 = [number, number, number];

/** Point-inside tests for every ACTIVE clipping volume: the main clipping box
 *  (when clipping + box are on) and each enabled clip shape (first 7, like the
 *  GPU; skipped while shapes are muted). Geometric interior — a shape's
 *  `inverted` flag is deliberately ignored. Mirrors clipPack's gating. */
export function activeClipVolumes(): ((p: P3) => boolean)[] {
  const out: ((p: P3) => boolean)[] = [];
  const box = ribbonClippingBoxState.get();
  if (!box.enabled) {
    return out; // master clipping toggle off — nothing is clipping
  }
  const insideBox =
    (center: P3, half: P3, rows: readonly P3[]) =>
    (p: P3): boolean => {
      for (let k = 0; k < 3; k++) {
        const d = (p[0] - center[0]) * rows[k][0] + (p[1] - center[1]) * rows[k][1] + (p[2] - center[2]) * rows[k][2];
        if (Math.abs(d) > half[k]) {
          return false;
        }
      }
      return true;
    };
  if (box.boxOn) {
    out.push(insideBox(box.center, [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2], quatAxes(box.rotation)));
  }
  const shp = clipShapesState.get();
  if (shp.muted) {
    return out;
  }
  for (const s of shp.shapes.slice(0, 7)) {
    if (!s.enabled) {
      continue;
    }
    if (s.kind === 'sphere') {
      out.push((p) => Math.hypot(p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2]) <= s.radius);
    } else if (s.kind === 'box') {
      out.push(insideBox(s.center, s.halfExtents, quatAxes(s.rotation)));
    } else {
      // cylinder: `center` is the middle, spans ±height/2 along the axis
      const al = Math.hypot(s.axis[0], s.axis[1], s.axis[2]) || 1;
      const a: P3 = [s.axis[0] / al, s.axis[1] / al, s.axis[2] / al];
      out.push((p) => {
        const d: P3 = [p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2]];
        const t = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
        if (Math.abs(t) > s.height / 2) {
          return false;
        }
        return Math.hypot(d[0] - t * a[0], d[1] - t * a[1], d[2] - t * a[2]) <= s.radius;
      });
    }
  }
  return out;
}

// snapshot undo (own domain like coloring/transforms — never global)
const undoStack: SceneLabel[][] = [];
const redoStack: SceneLabel[][] = [];

const clone = (items: SceneLabel[]): SceneLabel[] => items.map((l) => ({ ...l }));

/** Push the CURRENT items as an undo step (call before mutating). */
function snapshot() {
  undoStack.push(clone(labelsState.get().items));
  if (undoStack.length > LABEL_UNDO_MAX) {
    undoStack.shift();
  }
  redoStack.length = 0;
}

function commit(items: SceneLabel[]) {
  labelsState.set((s) => ({
    items,
    version: s.version + 1,
    undoDepth: undoStack.length,
    redoDepth: redoStack.length,
  }));
}

export const labelsActions = {
  /** Replace the whole label set (viewpoints activate/restore). Ids are
   *  re-based so future placements never collide with restored labels. */
  setAll(items: SceneLabel[]) {
    snapshot();
    commit(items.map((l) => ({ ...l, id: nextId++, selected: false })));
  },

  /** Hide/show every label in the viewport (does not touch the items).
   *  Show all ALSO unmutes individually muted labels — the escape hatch for
   *  per-label mutes on labels that are hard to reach once hidden. */
  toggleMuted() {
    labelsState.set((s) =>
      s.muted
        ? {
            muted: false,
            items: s.items.map((l) => (l.muted ? { ...l, muted: false } : l)),
            version: s.version + 1,
          }
        : { muted: true },
    );
  },

  /** Mute the SELECTED labels (per-label). Toggles: when every selected label
   *  is already muted, unmute them instead. Not an undo step (presentation
   *  state, like the global mute). */
  muteSelected() {
    const sel = labelsState.get().items.filter((l) => l.selected);
    if (sel.length === 0) {
      return;
    }
    const mute = !sel.every((l) => l.muted);
    labelsState.set((s) => ({
      items: s.items.map((l) => (l.selected ? { ...l, muted: mute } : l)),
      version: s.version + 1,
    }));
  },

  /** Arm placement: the next viewport click creates a label there. */
  startPlacing() {
    labelsState.set((s) => ({ placing: !s.placing }));
  },

  /** Place a new hand label at a picked world point (from the viewport). */
  placeAt(point: [number, number, number]) {
    const s = labelsState.get();
    labelsState.set({ placing: false });
    if (s.items.length >= MAX_LABELS) {
      dialogs.error(`Label limit reached (${MAX_LABELS}).`, 'Labels');
      return;
    }
    snapshot();
    commit([
      ...s.items,
      {
        id: nextId++,
        text: `Label ${nextId - 1}`,
        fullname: null,
        anchor: point,
        offset: [0, 0],
        selected: false,
        bg: s.bg,
        opacity: s.opacity,
        textColor: s.textColor,
      },
    ]);
  },

  update(id: number, patch: Partial<SceneLabel>) {
    snapshot();
    commit(labelsState.get().items.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  },

  /** Live text editing — no undo step per keystroke. */
  setText(id: number, text: string) {
    labelsState.set((s) => ({
      items: s.items.map((l) => (l.id === id ? { ...l, text } : l)),
      version: s.version + 1,
    }));
  },

  /** Live fullname (link) editing — no undo step per keystroke. */
  setFullname(id: number, fullname: string) {
    labelsState.set((s) => ({
      items: s.items.map((l) => (l.id === id ? { ...l, fullname: fullname || null } : l)),
      version: s.version + 1,
    }));
  },

  /** Arm anchor reposition for one label (click in the viewport to move it). */
  startReposition(id: number) {
    labelsState.set((s) => ({ repositionId: s.repositionId === id ? null : id, placing: false }));
  },

  /** Move a label's world anchor (one undo step), disarm reposition. Pass the
   *  compensating screen offset to keep a dragged label box where it is. */
  moveAnchor(id: number, point: [number, number, number], offset?: [number, number]) {
    snapshot();
    labelsState.set({ repositionId: null });
    commit(labelsState.get().items.map((l) => (l.id === id ? { ...l, anchor: point, offset: offset ?? l.offset } : l)));
  },

  remove(id: number) {
    snapshot();
    commit(labelsState.get().items.filter((l) => l.id !== id));
  },

  removeSelected() {
    snapshot();
    commit(labelsState.get().items.filter((l) => !l.selected));
  },

  clearAll() {
    if (labelsState.get().items.length === 0) {
      return;
    }
    snapshot();
    commit([]);
  },

  toggleSelect(id: number) {
    // selection changes are cheap/rapid — not an undo step
    labelsState.set((s) => ({
      items: s.items.map((l) => (l.id === id ? { ...l, selected: !l.selected } : l)),
      version: s.version + 1,
    }));
  },

  invertSelection() {
    labelsState.set((s) => ({
      items: s.items.map((l) => ({ ...l, selected: !l.selected })),
      version: s.version + 1,
    }));
  },

  selectAllLabels() {
    labelsState.set((s) => ({
      items: s.items.map((l) => (l.selected ? l : { ...l, selected: true })),
      version: s.version + 1,
    }));
  },

  deselectAllLabels() {
    labelsState.set((s) => ({
      items: s.items.map((l) => (l.selected ? { ...l, selected: false } : l)),
      version: s.version + 1,
    }));
  },

  /** "Select bbox": replace the label selection with every label whose anchor
   *  lies inside an active clipping volume (main box or enabled shape). */
  selectInsideClip() {
    const vols = activeClipVolumes();
    if (vols.length === 0) {
      return;
    }
    labelsState.set((s) => ({
      items: s.items.map((l) => ({ ...l, selected: vols.some((inside) => inside(l.anchor)) })),
      version: s.version + 1,
    }));
  },

  /** "Hide outside bbox": mute every label whose anchor lies OUTSIDE all
   *  active clipping volumes; labels inside are unmuted — show exactly what
   *  the clipped region contains. Show all clears the mutes again. */
  muteOutsideClip() {
    const vols = activeClipVolumes();
    if (vols.length === 0) {
      return;
    }
    labelsState.set((s) => ({
      items: s.items.map((l) => ({ ...l, muted: !vols.some((inside) => inside(l.anchor)) })),
      version: s.version + 1,
    }));
  },

  /** Live drag: move without an undo step; call dragEnd() once on release. */
  dragMove(id: number, offset: [number, number]) {
    labelsState.set((s) => ({
      items: s.items.map((l) => (l.id === id ? { ...l, offset } : l)),
      version: s.version + 1,
    }));
  },

  /** Commit a finished drag as ONE undo step (preOffset = offset at pointerdown). */
  dragEnd(id: number, preOffset: [number, number]) {
    const items = labelsState.get().items;
    const l = items.find((x) => x.id === id);
    if (!l || (l.offset[0] === preOffset[0] && l.offset[1] === preOffset[1])) {
      return;
    }
    const before = clone(items).map((x) => (x.id === id ? { ...x, offset: preOffset } : x));
    undoStack.push(before);
    if (undoStack.length > LABEL_UNDO_MAX) {
      undoStack.shift();
    }
    redoStack.length = 0;
    labelsState.set({ undoDepth: undoStack.length, redoDepth: 0 });
  },

  /** Apply the panel style (bg/opacity/text color) to the selected labels. */
  setStyle(patch: Partial<Pick<SceneLabel, 'bg' | 'opacity' | 'textColor'>>) {
    labelsState.set(patch);
    const items = labelsState.get().items;
    if (items.some((l) => l.selected)) {
      snapshot();
      commit(items.map((l) => (l.selected ? { ...l, ...patch } : l)));
    }
  },

  setLeaderColor(leaderColor: string) {
    // version bump: label BORDERS follow the leader colour and only restyle
    // on rebuild (leader lines themselves redraw every frame)
    labelsState.set((s) => ({ leaderColor, version: s.version + 1 }));
  },

  setRichText(richText: boolean) {
    labelsState.set((s) => ({ richText, version: s.version + 1 }));
  },

  setSnapToItem(snapToItem: boolean) {
    labelsState.set({ snapToItem });
  },

  /** Tag-import store scope ('' = resolve across all stores). */
  setImportStore(importStore: string) {
    labelsState.set({ importStore });
  },

  undo() {
    const prev = undoStack.pop();
    if (!prev) {
      return;
    }
    redoStack.push(clone(labelsState.get().items));
    commit(prev);
  },

  redo() {
    const next = redoStack.pop();
    if (!next) {
      return;
    }
    undoStack.push(clone(labelsState.get().items));
    commit(next);
  },

  setExplodeShape(explodeShape: 'circle' | 'box') {
    labelsState.set({ explodeShape });
  },

  /** Explode: fan the labels outward from the cluster center onto a circle or
   *  box, evenly spaced in their natural angular order so leader lines don't
   *  cross. Each press pushes them further out. One undo step. */
  explode() {
    const r = getRenderer();
    if (!r?.canvasEl) {
      return;
    }
    const s = labelsState.get();
    const w = r.canvasEl.clientWidth;
    const h = r.canvasEl.clientHeight;
    // project every label anchor; skip ones behind the camera
    const pts: { id: number; at: [number, number] }[] = [];
    for (const l of s.items) {
      const at = projectToScreen(r.viewProjMatrix, w, h, l.anchor);
      if (at) {
        pts.push({ id: l.id, at });
      }
    }
    if (pts.length === 0) {
      return;
    }
    const cx = pts.reduce((a, p) => a + p.at[0], 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.at[1], 0) / pts.length;
    // Remember the view this explode is laid out for. Pressing Explode again
    // from the SAME view angle grows the ring further out; from a CHANGED view
    // it starts a fresh explode (step 1) recomputed for the new projection.
    const view = Array.from(r.viewProjMatrix, (v) => v.toFixed(3)).join(',');
    const sameView = s.explodeView === view && s.explodeStep > 0;
    const step = sameView ? s.explodeStep + 1 : 1;
    // keep each label near its OWN anchor angle (short, mostly-radial lines),
    // then relax so neighbours are at least `gap` apart — order is preserved,
    // so leader lines can't cross each other
    const sorted = pts
      .map((p) => ({ ...p, ang: Math.atan2(p.at[1] - cy, p.at[0] - cx) }))
      .sort((a, b) => a.ang - b.ang);
    const n = sorted.length;
    const angles = sorted.map((p) => p.ang);
    const gap = Math.min((2 * Math.PI) / n, 0.3);
    for (let it = 0; it < 48; it++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const raw = angles[j] - angles[i];
        const d = i === n - 1 ? raw + 2 * Math.PI : raw;
        if (d < gap) {
          const push = (gap - d) / 2;
          angles[i] -= push;
          angles[j] += push;
        }
      }
    }
    // Size the layout from the PROJECTED anchor cluster (this view), so the
    // labels always land OUTSIDE the circle/box the anchors form on screen — a
    // fixed viewport fraction would sit inside a wide spread or way outside a
    // tight one. Take the cluster's max spread from the centroid, add a margin
    // for the label box, and make sure the ring is long enough that n boxes
    // don't overlap. Each press grows it further out.
    let clusterR = 0;
    let clusterHW = 0;
    let clusterHH = 0;
    for (const p of pts) {
      clusterR = Math.max(clusterR, Math.hypot(p.at[0] - cx, p.at[1] - cy));
      clusterHW = Math.max(clusterHW, Math.abs(p.at[0] - cx));
      clusterHH = Math.max(clusterHH, Math.abs(p.at[1] - cy));
    }
    const margin = 90; // ≈ label half-width + gap, so boxes clear the cluster
    const fitR = (n * 150) / (2 * Math.PI); // circumference that fits n boxes
    const grow = (step - 1) * 55;

    // each label's target screen position on the ring / box perimeter
    const targets = sorted.map((p, i) => {
      const ang = angles[i];
      if (s.explodeShape === 'circle') {
        const rad = Math.max(clusterR + margin, fitR) + grow;
        return { id: p.id, x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad };
      }
      // box: push the unit direction until it hits the rectangle perimeter,
      // sized to enclose the projected cluster (+ margin) rather than the viewport
      const hw = Math.max(clusterHW + margin, fitR) + grow;
      const hh = Math.max(clusterHH + margin, fitR * 0.75) + grow;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const k = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
      return { id: p.id, x: cx + dx * k, y: cy + dy * k };
    });

    // De-overlap. Keep every target inside the viewport (label ≈ 140×22 px)
    // BEFORE and DURING separation — clamping only at the end would pull a
    // spread-out column back onto the edge and re-stack it. Clamping each push
    // means a label pinned at an edge stays put and its neighbour is the one
    // that slides into free space.
    const mx = 80;
    const my = 22;
    const clampX = (x: number) => Math.max(mx, Math.min(w - mx, x));
    const clampY = (y: number) => Math.max(my, Math.min(h - my, y));
    for (const t of targets) {
      t.x = clampX(t.x);
      t.y = clampY(t.y);
    }
    // Nudge apart any two label boxes that intersect, along the axis of least
    // penetration (usually vertical — boxes are wide + short), re-clamping each
    // push. A stack near an edge unstacks by walking labels back into the view.
    const LW = 156; // ≈ label box width + gap
    const LH = 26; //  ≈ label box height + gap
    for (let it = 0; it < 200; it++) {
      let moved = false;
      for (let a = 0; a < targets.length; a++) {
        for (let b = a + 1; b < targets.length; b++) {
          const A = targets[a];
          const B = targets[b];
          const ox = LW - Math.abs(B.x - A.x);
          const oy = LH - Math.abs(B.y - A.y);
          if (ox <= 0 || oy <= 0) {
            continue; // not overlapping
          }
          moved = true;
          if (oy <= ox) {
            const push = (oy / 2) * (B.y >= A.y ? 1 : -1);
            A.y = clampY(A.y - push);
            B.y = clampY(B.y + push);
          } else {
            const push = (ox / 2) * (B.x >= A.x ? 1 : -1);
            A.x = clampX(A.x - push);
            B.x = clampX(B.x + push);
          }
        }
      }
      if (!moved) {
        break;
      }
    }

    const offsets = new Map<number, [number, number]>();
    targets.forEach((t, i) => {
      const p = sorted[i];
      offsets.set(t.id, [t.x - p.at[0], t.y - p.at[1]]);
    });
    snapshot();
    labelsState.set({ explodeStep: step, explodeView: view });
    commit(
      labelsState.get().items.map((l) => {
        const o = offsets.get(l.id);
        return o ? { ...l, offset: o } : l;
      }),
    );
  },

  /** Implode: every label returns to its anchor (clears explode + manual drags). */
  implode() {
    snapshot();
    labelsState.set({ explodeStep: 0, explodeView: null });
    commit(labelsState.get().items.map((l) => ({ ...l, offset: [0, 0] as [number, number] })));
  },

  /** Tag import. Returns the not-found names (the panel writes them back into
   *  the paste box). replace = drop all existing labels first; duplicates (by
   *  fullname) are silently skipped. */
  async importTags(text: string, mode: 'append' | 'replace'): Promise<string[]> {
    const names = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.toLowerCase().startsWith('not found:'));
    if (names.length === 0) {
      return [];
    }
    const { snapToItem, importStore } = labelsState.get();
    const onlyModels = importStore ? await loadedIndicesForStore(importStore) : undefined;
    const { found, notFound } = await db.findLabelAnchors(names, snapToItem, onlyModels);
    const s = labelsState.get();
    const base = mode === 'replace' ? [] : s.items;
    // duplicates key on fullname AND anchor: the same tag resolved in two
    // plants is two distinct labels, re-importing the same plant's tag is not
    const labelKey = (name: string, anchor: readonly number[]): string =>
      `${name}\0${anchor.map((v) => v.toFixed(2)).join(',')}`;
    const existing = new Set(base.filter((l) => l.fullname != null).map((l) => labelKey(l.fullname!, l.anchor)));
    const fresh = found.filter((f) => !existing.has(labelKey(f.name, f.center)));
    const room = MAX_LABELS - base.length;
    if (fresh.length > room) {
      dialogs.error(`Label limit is ${MAX_LABELS} — only the first ${room} new tags were added.`, 'Labels');
    }
    snapshot();
    commit([
      ...base,
      ...fresh.slice(0, Math.max(0, room)).map((f) => ({
        id: nextId++,
        text: f.name,
        fullname: f.name,
        anchor: f.center,
        offset: [0, 0] as [number, number],
        selected: false,
        bg: s.bg,
        opacity: s.opacity,
        textColor: s.textColor,
      })),
    ]);
    consoleActions.log(
      'info',
      `Labels → imported ${Math.min(fresh.length, Math.max(0, room))} of ${names.length} tag(s), ${notFound.length} not found`,
    );
    return notFound;
  },

  /** Save all labels (+ the shared style) to a downloaded JSON file. */
  downloadJson() {
    downloadText('labels.json', this.exportJson());
  },

  /** Serialize the label set for sharing/backup. */
  exportJson(): string {
    const s = labelsState.get();
    return JSON.stringify(
      {
        items: s.items,
        muted: s.muted,
        style: { bg: s.bg, opacity: s.opacity, textColor: s.textColor, leaderColor: s.leaderColor },
      },
      (_k, v) => (typeof v === 'number' ? +v.toFixed(6) : v),
      2,
    );
  },

  /** Load a label set, replacing the current one. Returns the count loaded. */
  importJson(text: string): number {
    const data = JSON.parse(text) as {
      items?: SceneLabel[];
      muted?: boolean;
      style?: Partial<Pick<LabelsState, 'bg' | 'opacity' | 'textColor' | 'leaderColor'>>;
    };
    const items = (data.items ?? []).filter(
      (l) => l && typeof l.text === 'string' && Array.isArray(l.anchor) && l.anchor.length === 3,
    );
    for (const l of items) {
      l.offset = Array.isArray(l.offset) && l.offset.length === 2 ? l.offset : [0, 0];
      l.fullname = l.fullname ?? null;
      l.bg = l.bg ?? labelsState.get().bg;
      l.opacity = l.opacity ?? 1;
      l.textColor = l.textColor ?? labelsState.get().textColor;
    }
    labelsState.set({ muted: data.muted ?? false, ...(data.style ?? {}) });
    // setAll re-bases ids and snapshots for undo
    this.setAll(items.slice(0, MAX_LABELS));
    return Math.min(items.length, MAX_LABELS);
  },
};
