// The STATE undo stack — color, opacity AND visibility share one undo domain
// (the same band the .tdsnap color channel covers). This module owns the
// stack; apiColor and apiVisibility push their steps through the exported
// capture/push helpers. Transforms have their own stack; no global undo.
import { HAS_COLOR_OVERRIDE, HAS_OPACITY_OVERRIDE, IS_HIDDEN, models, OPACITY_MASK } from './dbState';

/** One undo RECORD per model: the model's ENTIRE color band as drawrange-style
 *  RLE runs — u32 quads [start, count, flags, color] over the dense item
 *  index space. A model painted one color is ONE run (16 bytes) however many
 *  items it has: memory scales with distinct state runs, not item count. */
export interface ColorUndoRecord {
  model: number;
  runs: Uint32Array;
}

/** One undo STEP per user action: every model that action touched, captured
 *  ONCE (full band, before its first mutation). Undo/redo pop whole steps —
 *  coloring 100 files with 20 rules is still ONE undo press. */
type ColorUndoStep = ColorUndoRecord[];
const colorUndo: ColorUndoStep[] = [];
const colorRedo: ColorUndoStep[] = [];
const COLOR_UNDO_MAX_BYTES = 64 << 20; // cap by memory, not count (per stack)
let colorUndoBytes = 0;
let colorRedoBytes = 0;

const colorStepBytes = (step: ColorUndoStep): number => step.reduce((n, r) => n + r.runs.byteLength, 0);

/** Evict WHOLE oldest steps until the stack fits the cap — an old action never
 *  becomes partially undoable, and the newest step is never evicted (one
 *  oversized action stays undoable). Returns the adjusted byte count. */
function evictColorSteps(stack: ColorUndoStep[], bytes: number): number {
  let b = bytes;
  while (b > COLOR_UNDO_MAX_BYTES && stack.length > 1) {
    b -= colorStepBytes(stack.shift()!);
  }
  return b;
}

export function pushColorUndo(step: ColorUndoStep) {
  if (step.length === 0) {
    return;
  }
  colorRedo.length = 0; // a fresh edit invalidates the redo branch
  colorRedoBytes = 0;
  colorUndo.push(step);
  colorUndoBytes = evictColorSteps(colorUndo, colorUndoBytes + colorStepBytes(step));
}

// the full STATE band: hidden flag, color-override bit, opacity bit, opacity
// value — the same channel a .tdsnap records. Restored together so one undo
// press reverts everything one action changed (a Set Color run that also set
// opacity, an isolate, …); the selection bit in the same word is deliberately
// left alone.
export const COLOR_UNDO_BITS = (IS_HIDDEN | HAS_COLOR_OVERRIDE | HAS_OPACITY_OVERRIDE | OPACITY_MASK) >>> 0;

/** RLE-capture one model's whole state band. The color word is meaningless
 *  without the override bit and may hold stale per-item values — normalized
 *  to 0 in the run key so runs stay long instead of fragmenting per item. */
export function captureColorRuns(model: number): ColorUndoRecord {
  const m = models[model];
  const runs: number[] = [];
  if (m.itemCount > 0) {
    let start = 0;
    let runFlags = m.states[0] & COLOR_UNDO_BITS;
    let runColor = runFlags & HAS_COLOR_OVERRIDE ? m.states[1] : 0;
    for (let i = 1; i < m.itemCount; i++) {
      const flags = m.states[i * 2] & COLOR_UNDO_BITS;
      const color = flags & HAS_COLOR_OVERRIDE ? m.states[i * 2 + 1] : 0;
      if (flags !== runFlags || color !== runColor) {
        runs.push(start, i - start, runFlags, runColor);
        start = i;
        runFlags = flags;
        runColor = color;
      }
    }
    runs.push(start, m.itemCount - start, runFlags, runColor);
  }
  return { model, runs: Uint32Array.from(runs) };
}

function restoreColorRuns(rec: ColorUndoRecord) {
  const m = models[rec.model];
  const runs = rec.runs;
  for (let r = 0; r < runs.length; r += 4) {
    const end = runs[r] + runs[r + 1];
    const flags = runs[r + 2];
    const color = runs[r + 3];
    const hasColor = (flags & HAS_COLOR_OVERRIDE) !== 0;
    for (let i = runs[r]; i < end; i++) {
      m.states[i * 2] = (m.states[i * 2] & ~COLOR_UNDO_BITS) | flags;
      if (hasColor) {
        m.states[i * 2 + 1] = color;
      }
    }
  }
}

/** Drop both coloring-undo stacks (clear / snapshot REPLACE-import). */
export function resetColorUndo(): void {
  colorUndo.length = 0;
  colorRedo.length = 0;
  colorUndoBytes = 0;
  colorRedoBytes = 0;
}

/** Pop + restore one undo step; returns the model indices restored (empty =
 *  nothing to undo). Records are one-per-model full-band captures, so the
 *  inverse pushed onto redo is simply a fresh capture of each model. */
export function undoColorStep(): number[] {
  const step = colorUndo.pop();
  if (!step) {
    return [];
  }
  colorUndoBytes -= colorStepBytes(step);
  const inverse = step.map((r) => captureColorRuns(r.model));
  colorRedo.push(inverse);
  colorRedoBytes = evictColorSteps(colorRedo, colorRedoBytes + colorStepBytes(inverse));
  for (const rec of step) {
    restoreColorRuns(rec);
  }
  return step.map((r) => r.model);
}

/** Pop + restore one redo step; returns the model indices restored. The
 *  inverse goes back onto undo WITHOUT clearing redo. */
export function redoColorStep(): number[] {
  const step = colorRedo.pop();
  if (!step) {
    return [];
  }
  colorRedoBytes -= colorStepBytes(step);
  const inverse = step.map((r) => captureColorRuns(r.model));
  colorUndo.push(inverse);
  colorUndoBytes = evictColorSteps(colorUndo, colorUndoBytes + colorStepBytes(inverse));
  for (const rec of step) {
    restoreColorRuns(rec);
  }
  return step.map((r) => r.model);
}

export function colorUndoDepth(): number {
  return colorUndo.length;
}

export function colorRedoDepth(): number {
  return colorRedo.length;
}
