import { createStore } from '@treDeSpaceUI/lib/createStore';
import { storageKey } from '../../../lib/storageKeys';

export interface RibbonSelectionTransformState {
  unit: 'm' | 'cm' | 'mm';
  step: number;
  /** viewport gizmo on the selection ('none' = hidden) */
  gizmoMode: 'none' | 'move' | 'rotate' | 'scale';
  /** locked custom pivot for rotate/scale (native custom_pivot); null = selection center */
  pivot: [number, number, number] | null;
  /** placement mode: arrows at the pivot, drag to move it, then Lock/Cancel */
  pivotSetting: boolean;
  /** helper toggle: clicking an item sets the pivot to that item's center */
  pivotFromItem: boolean;
  /** one-shot: the next viewport click moves the selection so its bounds
   * BOTTOM center lands on the clicked point */
  moveToClickArmed: boolean;
  /** Leaving the Transform ribbon (another ribbon tab, or a layout slot
   *  switch) disarms the gizmo, pivot placement and move-to-click — so a mode
   *  that reacts to viewport clicks never lingers while the user works
   *  elsewhere. Default on; persisted. */
  offOnRibbonSwitch: boolean;
}

const KEY = storageKey('ribbonSelectionTransform');

const DEFAULTS: RibbonSelectionTransformState = {
  unit: 'm',
  step: 1,
  gizmoMode: 'none',
  pivot: null,
  pivotSetting: false,
  pivotFromItem: false,
  moveToClickArmed: false,
  offOnRibbonSwitch: true,
};

/** Only the preference is restored — every armed mode is session state. */
function load(): RibbonSelectionTransformState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return DEFAULTS;
    }
    const saved = JSON.parse(raw) as Partial<RibbonSelectionTransformState>;
    return { ...DEFAULTS, offOnRibbonSwitch: saved.offOnRibbonSwitch !== false };
  } catch {
    return DEFAULTS;
  }
}

export const ribbonSelectionTransformState = createStore<RibbonSelectionTransformState>(load());

ribbonSelectionTransformState.subscribe(() => {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ offOnRibbonSwitch: ribbonSelectionTransformState.get().offOnRibbonSwitch }),
    );
  } catch {
    // storage unavailable — non-fatal
  }
});
