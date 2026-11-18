// Temporary isolate (Hierarchy toolbar): isolate the selection, and later put
// back exactly what that isolate changed — nothing the user did in between.
// It keeps the same RLE captures the state undo stack uses (colorUndo.ts): the
// band BEFORE the isolate (also the undo step it pushes) and AFTER it. Ending
// compares their hidden bits: what the isolate hid is shown again, what it
// showed (selected items that were hidden) is hidden again. Only the hidden
// bit is touched, so colours set while isolated stay, and parts hidden while
// isolated stay hidden.
import { type ColorUndoRecord, captureColorRuns, pushColorUndo } from './colorUndo';
import { IS_HIDDEN, models, type StateUpdate } from './dbState';
import { packStates, transferUpdates } from './hierarchyIndex';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

type IsolateCapture = Readonly<{ before: ColorUndoRecord; after: ColorUndoRecord; itemCount: number }>;

// -----------------------------------------------------------------------------
// state
// -----------------------------------------------------------------------------

/** model index → its captures, while a temporary isolate is on; null when off. */
let active: Map<number, IsolateCapture> | null = null;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** One capture's hidden bit per item, unpacked from its RLE runs. */
function hiddenFlags(rec: ColorUndoRecord, itemCount: number): Uint8Array {
  const out = new Uint8Array(itemCount);
  const runs = rec.runs;
  for (let r = 0; r < runs.length; r += 4) {
    if (runs[r + 2] & IS_HIDDEN) {
      out.fill(1, runs[r], Math.min(itemCount, runs[r] + runs[r + 1]));
    }
  }
  return out;
}

/** Drop the record — for every model, or only `indices` (forgotten models,
 *  whose slot a later load may revive with fresh state). */
export function forgetTempIsolate(indices?: readonly number[]): void {
  if (!active) {
    return;
  }
  if (!indices) {
    active = null;
    return;
  }
  for (const i of indices) {
    active.delete(i);
  }
  if (active.size === 0) {
    active = null; // nothing left to put back: the toggle reads as off
  }
}

// -----------------------------------------------------------------------------
// api
// -----------------------------------------------------------------------------

export const tempIsolateApi = {
  /** Isolate the selection (hide everything else, show the selection) and
   *  remember the before/after state band of every model it changed. One
   *  undo step, like Isolate. A second start replaces the first record. */
  tempIsolateStart(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    const record = new Map<number, IsolateCapture>();
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      const sel = new Uint8Array(m.itemCount);
      for (const it of m.selected) {
        sel[it] = 1;
      }
      let isChanging = false;
      for (let i = 0; i < m.itemCount && !isChanging; i++) {
        isChanging = (sel[i] === 1) === ((m.states[i * 2] & IS_HIDDEN) !== 0);
      }
      if (!isChanging) {
        return;
      }
      const before = captureColorRuns(idx);
      for (let i = 0; i < m.itemCount; i++) {
        if (sel[i]) {
          m.states[i * 2] &= ~IS_HIDDEN;
        } else {
          m.states[i * 2] |= IS_HIDDEN;
        }
      }
      step.push(before);
      record.set(idx, { before, after: captureColorRuns(idx), itemCount: m.itemCount });
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    active = record;
    return transferUpdates(updates);
  },

  /** Put back what the temporary isolate changed — its hides and the hidden
   *  selected items it showed — and nothing else. One undo step. */
  tempIsolateEnd(): StateUpdate[] {
    const record = active;
    active = null;
    if (!record) {
      return [];
    }
    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    for (const [idx, cap] of record) {
      const m = models[idx];
      if (!m || m.removed || m.itemCount !== cap.itemCount) {
        continue;
      }
      const wasHidden = hiddenFlags(cap.before, cap.itemCount);
      const isolateHid = hiddenFlags(cap.after, cap.itemCount);
      step.push(captureColorRuns(idx));
      for (let i = 0; i < m.itemCount; i++) {
        if (!wasHidden[i] && isolateHid[i]) {
          m.states[i * 2] &= ~IS_HIDDEN;
        } else if (wasHidden[i] && !isolateHid[i]) {
          m.states[i * 2] |= IS_HIDDEN;
        }
      }
      updates.push(packStates(m, idx));
    }
    pushColorUndo(step);
    return transferUpdates(updates);
  },

  /** A temporary isolate is on (something to put back). */
  tempIsolateActive(): boolean {
    return active !== null;
  },
};
