// Timeline gestures (DESIGN.md › Animation › Authoring): picking rows,
// keys, steps and callouts, and dragging them. A drag reports the total
// shift since it began, so the rows are taken at its first move and every
// report rebuilds from them (one undo step per drag).

import type { Callout, CalloutKey, Scene, Step } from '../../../lib/animation/types';
import { animationDocActions, GESTURE_COALESCE } from '../../../state/animation/animationDoc.actions';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { calloutsActions } from '../../../state/animation/callouts.actions';
import { activeScene, mapActiveScene } from '../../../state/animation/docEdit';
import { keysActions } from '../../../state/animation/keys.actions';
import { objectsActions } from '../../../state/animation/objects.actions';
import { playerActions } from '../../../state/animation/player.actions';
import { type KeyRow, objectRow, type RowId, rowObject } from '../../../state/animation/rows';
import { stepsActions } from '../../../state/animation/steps.actions';
import { parseItem, parsePoint } from './timelineIds';

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

/** The scene as a drag found it (null between drags). */
let dragBase: Scene | null = null;
let dragSeq = 0;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** One drag is one undo step, however slowly it goes. */
function dragCoalesce(): string {
  return `${GESTURE_COALESCE}timeline-drag:${dragSeq}`;
}

function baseScene(phase: 'drag' | 'end'): Scene | null {
  if (!dragBase) {
    dragBase = activeScene();
    dragSeq++;
  }
  const s = dragBase;
  if (phase === 'end') {
    dragBase = null;
  }
  return s;
}

function moveStep(steps: readonly Step[], id: string, dt: number): Step[] {
  const sorted = [...steps].sort((a, b) => a.start - b.start);
  const i = sorted.findIndex((x) => x.id === id);
  const st = sorted[i];
  if (!st) {
    return [...steps];
  }
  const lo = sorted[i - 1]?.end ?? 0;
  const hi = sorted[i + 1]?.start ?? Infinity;
  const len = st.end - st.start;
  const a = Math.max(lo, Math.min(st.start + dt, hi - len));
  return sorted.map((x) => (x.id === id ? { ...x, start: a, end: a + len } : x));
}

function moveCallout(callouts: readonly Callout[], ids: ReadonlySet<string>, dt: number): Callout[] {
  return callouts.map((c) => {
    if (!ids.has(c.id)) {
      return c;
    }
    const d = Math.max(-c.start, dt);
    return { ...c, start: c.start + d, end: c.end + d };
  });
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const timelineEditActions = {
  /** A row picked: it becomes current (Key keys it); an object's items get
   *  selected so the gizmo sits on them — with `additive` (Ctrl) the object
   *  joins or leaves the objects selected, with `range` (Shift) every object
   *  from the current one to it is selected: one gizmo drag poses them all. */
  pickRow(row: RowId, mods: { additive?: boolean; range?: boolean } = {}): void {
    const object = rowObject(row);
    const ui = animationUiState.get();
    const objects = activeScene()?.objects.map((o) => o.id) ?? [];
    const anchor = rowObject(ui.current);
    animationUiActions.setCurrent(row);
    animationUiActions.pick({ kind: 'none' });
    if (!object) {
      return;
    }
    if (mods.range && anchor && objects.includes(anchor)) {
      const [a, b] = [objects.indexOf(anchor), objects.indexOf(object)].sort((x, y) => x - y);
      const run = objects.slice(a, b + 1);
      // shown at once; the selection sync confirms it when the worker answers
      animationUiState.set({ objectSelection: run });
      void objectsActions.selectObjects(run);
      animationUiActions.setCurrent(objectRow(anchor));
      return;
    }
    if (mods.additive) {
      const was = ui.objectSelection;
      const next = was.includes(object) ? was.filter((x) => x !== object) : [...was, object];
      animationUiState.set({ objectSelection: next });
      void objectsActions.selectObjects(next);
      return;
    }
    void objectsActions.selectItems(object);
  },

  /** What a click or box selection picked. */
  select(sel: { items: string[]; points: string[] }, additive: boolean): void {
    const refs = sel.points.map(parsePoint);
    const first = refs[0];
    if (first?.kind === 'key') {
      const indices = refs.flatMap((r) => (r?.kind === 'key' && r.row === first.row ? [r.index] : []));
      // Ctrl / Shift adds only within the picked row; a key of another row
      // is a plain pick (the time slider and the selection go with it)
      const p = animationUiState.get().picked;
      const add = additive && p.kind === 'keys' && p.row === first.row;
      keysActions.pickKeys(first.row, indices, add);
      const object = rowObject(first.row);
      if (object && !add) {
        void objectsActions.selectItems(object);
      }
      return;
    }
    if (first?.kind === 'calloutKey') {
      const c = activeScene()?.callouts.find((x) => x.id === first.callout);
      animationUiActions.pick({ kind: 'callout', id: first.callout, keys: [first.index] });
      const k = c?.keys?.[first.index];
      if (c && k) {
        playerActions.seek(c.start + k.t);
      }
      return;
    }
    if (first?.kind === 'pause') {
      animationUiActions.pick({ kind: 'step', id: first.step });
      return;
    }
    const item = sel.items.map(parseItem)[0];
    if (item?.kind === 'scene') {
      timelineEditActions.pickRow('@scene');
    } else if (item?.kind === 'step') {
      animationUiActions.setCurrent('@steps');
      animationUiActions.pick({ kind: 'step', id: item.id });
    } else if (item?.kind === 'callout') {
      animationUiActions.setCurrent('@callouts');
      animationUiActions.pick({ kind: 'callout', id: item.id, keys: [] });
    } else if (item?.kind === 'span') {
      timelineEditActions.pickRow(item.row);
    } else if (!additive) {
      animationUiActions.pick({ kind: 'none' });
    }
  },

  /** Diamonds dragged by dt: keys of one row each, callout place keys. */
  movePoints(ids: readonly string[], dt: number, phase: 'drag' | 'end'): void {
    if (!animationUiActions.isAuthoring()) {
      return;
    }
    const base = baseScene(phase);
    if (!base) {
      return;
    }
    const byRow = new Map<KeyRow, number[]>();
    const byCallout = new Map<string, number[]>();
    for (const r of ids.map(parsePoint)) {
      if (r?.kind === 'key') {
        byRow.set(r.row, [...(byRow.get(r.row) ?? []), r.index]);
      } else if (r?.kind === 'calloutKey') {
        byCallout.set(r.callout, [...(byCallout.get(r.callout) ?? []), r.index]);
      }
    }
    const coalesce = dragCoalesce();
    for (const [row, indices] of byRow) {
      const moved = keysActions.retimeFrom(base, row, indices, dt, coalesce);
      if (phase === 'end') {
        keysActions.pickKeys(row, moved, false);
      }
    }
    for (const [id, indices] of byCallout) {
      const c = base.callouts.find((x) => x.id === id);
      const keys: CalloutKey[] = (c?.keys ?? []).map((k, i) =>
        indices.includes(i) ? { ...k, t: Math.max(0, k.t + dt) } : k,
      );
      calloutsActions.update(id, { keys: keys.sort((a, b) => a.t - b.t) }, coalesce);
    }
  },

  /** Bars dragged by dt: steps (inside their room) and callouts. */
  moveItems(ids: readonly string[], dt: number, phase: 'drag' | 'end'): void {
    if (!animationUiActions.isAuthoring()) {
      return;
    }
    const base = baseScene(phase);
    if (!base) {
      return;
    }
    const refs = ids.map(parseItem);
    const callouts = new Set(refs.flatMap((r) => (r?.kind === 'callout' ? [r.id] : [])));
    const step = refs.find((r) => r?.kind === 'step');
    animationDocActions.commit(
      (d) =>
        mapActiveScene(d, (s) => ({
          ...s,
          steps: step?.kind === 'step' ? moveStep(base.steps, step.id, dt) : s.steps,
          callouts: callouts.size > 0 ? moveCallout(base.callouts, callouts, dt) : s.callouts,
        })),
      dragCoalesce(),
    );
  },

  /** A bar's edge dragged to t. */
  resizeItem(id: string, edge: 'start' | 'end', t: number, phase: 'drag' | 'end'): void {
    if (!animationUiActions.isAuthoring()) {
      return;
    }
    const base = baseScene(phase);
    const ref = parseItem(id);
    const coalesce = dragCoalesce();
    if (ref?.kind === 'step') {
      const s = base?.steps.find((x) => x.id === ref.id);
      if (s) {
        stepsActions.setSpan(ref.id, edge === 'start' ? t : s.start, edge === 'end' ? t : s.end, coalesce);
      }
    } else if (ref?.kind === 'callout') {
      const c = base?.callouts.find((x) => x.id === ref.id);
      if (c) {
        calloutsActions.setSpan(ref.id, edge === 'start' ? t : c.start, edge === 'end' ? t : c.end, coalesce);
      }
    }
  },

  /** Keys typed on the focused Timeline: Delete, Ctrl+C / Ctrl+V, Home / End.
   *  True when handled. */
  handleKey(e: { key: string; ctrlKey: boolean; metaKey: boolean }, duration: number): boolean {
    const mod = e.ctrlKey || e.metaKey;
    if (animationUiState.get().mode.kind !== 'author' && e.key !== 'Home' && e.key !== 'End') {
      return false;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      return keysActions.deletePicked();
    }
    if (mod && (e.key === 'c' || e.key === 'C')) {
      return keysActions.copyPicked();
    }
    if (mod && (e.key === 'v' || e.key === 'V')) {
      return keysActions.paste();
    }
    if (e.key === 'Home') {
      playerActions.seek(0);
      return true;
    }
    if (e.key === 'End') {
      playerActions.seek(duration);
      return true;
    }
    return false;
  },
};
