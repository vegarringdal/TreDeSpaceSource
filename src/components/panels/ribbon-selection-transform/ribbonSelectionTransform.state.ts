import { createStore } from '@treDeSpaceUI/lib/createStore';

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
}

export const ribbonSelectionTransformState = createStore<RibbonSelectionTransformState>({
  unit: 'm',
  step: 1,
  gizmoMode: 'none',
  pivot: null,
  pivotSetting: false,
  pivotFromItem: false,
  moveToClickArmed: false,
});
