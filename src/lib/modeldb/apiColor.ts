// Coloring domain: color/opacity overrides on the selection. The MultiColor
// rule engine lives in colorRules; the shared STATE undo stack (color,
// opacity AND visibility — one band) lives in colorUndo. Every mutation here
// pushes a step through those helpers so one undo press reverts one action.

import { applyColorRules } from './colorRules';
import {
  COLOR_UNDO_BITS,
  type ColorUndoRecord,
  captureColorRuns,
  colorRedoDepth,
  colorUndoDepth,
  pushColorUndo,
  redoColorStep,
  undoColorStep,
} from './colorUndo';
import {
  HAS_COLOR_OVERRIDE,
  HAS_OPACITY_OVERRIDE,
  models,
  OPACITY_MASK,
  OPACITY_SHIFT,
  type StateUpdate,
} from './dbState';
import { packStates } from './hierarchyIndex';

export const colorApi = {
  /** Opacity override 0-100 on the selection (native flag bits 25-31).
   *  Undoable (state domain). */
  setOpacityOnSelection(pct: number): StateUpdate[] {
    const v = Math.max(0, Math.min(100, Math.round(pct)));
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
        m.states[it * 2] = ((m.states[it * 2] & ~OPACITY_MASK) | HAS_OPACITY_OVERRIDE | (v << OPACITY_SHIFT)) >>> 0;
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },

  resetOpacityOnSelection(): StateUpdate[] {
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
        m.states[it * 2] = (m.states[it * 2] & ~(OPACITY_MASK | HAS_OPACITY_OVERRIDE)) >>> 0;
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },

  resetAllOpacity(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      let any = false;
      for (let i = 0; i < m.itemCount; i++) {
        if (m.states[i * 2] & HAS_OPACITY_OVERRIDE) {
          any = true;
          break;
        }
      }
      if (!any) {
        return;
      }
      step.push(captureColorRuns(idx));
      for (let i = 0; i < m.itemCount; i++) {
        m.states[i * 2] = (m.states[i * 2] & ~(OPACITY_MASK | HAS_OPACITY_OVERRIDE)) >>> 0;
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },

  /** "Clear all": unhide everything + reset every color and opacity override,
   *  as ONE undo step (the whole state band is cleared in one pass). */
  clearAllOverrides(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      let any = false;
      for (let i = 0; i < m.itemCount; i++) {
        if (m.states[i * 2] & COLOR_UNDO_BITS) {
          any = true;
          break;
        }
      }
      if (!any) {
        return;
      }
      step.push(captureColorRuns(idx));
      for (let i = 0; i < m.itemCount; i++) {
        m.states[i * 2] = (m.states[i * 2] & ~COLOR_UNDO_BITS) >>> 0;
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },

  applyColorRules,

  /** Anything that needs the blend pass: a baked-transparent color group, an
   *  opacity override, or a color override whose packed alpha is < 255. */
  hasTransparency(): boolean {
    for (const m of models) {
      if (m.removed) {
        continue;
      }
      if (m.bakedTransparent) {
        return true;
      }
      for (let i = 0; i < m.itemCount; i++) {
        const flags = m.states[i * 2];
        if (flags & HAS_OPACITY_OVERRIDE) {
          return true;
        }
        if (flags & HAS_COLOR_OVERRIDE && ((m.states[i * 2 + 1] >>> 24) & 255) < 255) {
          return true;
        }
      }
    }
    return false;
  },

  /** Apply a packed RGBA8 color override to the current selection.
   * Pushes onto the COLORING undo stack (per-domain — never global). */
  applyColorToSelection(colorRGBA8: number): StateUpdate[] {
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
        m.states[it * 2] |= HAS_COLOR_OVERRIDE;
        m.states[it * 2 + 1] = colorRGBA8;
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },

  clearColorOnSelection(): StateUpdate[] {
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
        m.states[it * 2] &= ~HAS_COLOR_OVERRIDE;
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },

  /** Clear every color override everywhere (undoable, coloring domain). */
  resetAllColors(): StateUpdate[] {
    const updates: StateUpdate[] = [];
    const step: ColorUndoRecord[] = [];
    models.forEach((m, idx) => {
      if (m.removed) {
        return;
      }
      let any = false;
      for (let i = 0; i < m.itemCount; i++) {
        if (m.states[i * 2] & HAS_COLOR_OVERRIDE) {
          any = true;
          break;
        }
      }
      if (!any) {
        return;
      }
      step.push(captureColorRuns(idx));
      for (let i = 0; i < m.itemCount; i++) {
        m.states[i * 2] &= ~HAS_COLOR_OVERRIDE;
      }
      updates.push(packStates(m, idx));
    });
    pushColorUndo(step);
    return updates;
  },

  undoColor(): StateUpdate[] {
    return undoColorStep().map((model) => packStates(models[model], model));
  },

  redoColor(): StateUpdate[] {
    return redoColorStep().map((model) => packStates(models[model], model));
  },

  colorUndoDepth,

  colorRedoDepth,
};
