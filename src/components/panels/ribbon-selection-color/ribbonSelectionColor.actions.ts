import { db } from '../../../state/viewer/db';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { consoleActions } from '../console/console.actions';
import { ribbonClippingBoxState } from '../ribbon-clipping-box/ribbonClippingBox.state';
import { ribbonSelectionColorState } from './ribbonSelectionColor.state';

const clamp = (v: number) => Math.min(100, Math.max(0, v));

export const ribbonSelectionColorActions = {
  setCustomColor: (customColor: string) => ribbonSelectionColorState.set({ customColor }),
  setQuickOpacity: (quickOpacity: number) => ribbonSelectionColorState.set({ quickOpacity: clamp(quickOpacity) }),
  setOpacity: (opacity: number) => ribbonSelectionColorState.set({ opacity: clamp(opacity) }),
  bumpQuickOpacity: (dir: 1 | -1) =>
    ribbonSelectionColorState.set((s) => ({ quickOpacity: clamp(s.quickOpacity + dir * 5) })),
  bumpOpacity: (dir: 1 | -1) => ribbonSelectionColorState.set((s) => ({ opacity: clamp(s.opacity + dir * 5) })),

  /** Unhide everything intersecting the CURRENT clipping box (position, size
   *  and rotation as-is — the box does not need to be enabled). */
  async unhideInClipBox() {
    const { center, size, rotation } = ribbonClippingBoxState.get();
    await viewerActions.unhideIntersecting({ center: [...center], size: [...size], rotation: [...rotation] });
    consoleActions.log('info', 'Selection → unhid items intersecting the clipping box');
  },

  /** Unhide everything within the selection's bounds grown by the Clipping Box
   *  ribbon's Fit Sel offset on every side — the same volume Fit Sel +Off.
   *  would produce, without touching the clipping box. */
  async unhideAroundSelection() {
    const bounds = await db.selectionBounds();
    if (!bounds) {
      consoleActions.log('info', 'Selection → nothing selected, nothing to unhide around');
      return;
    }
    const { min, max } = bounds;
    const m = ribbonClippingBoxState.get().fitOffset;
    await viewerActions.unhideIntersecting({
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      size: [max[0] - min[0] + m * 2, max[1] - min[1] + m * 2, max[2] - min[2] + m * 2],
      rotation: [0, 0, 0, 1],
    });
    consoleActions.log('info', `Selection → unhid items within the selection bounds +${m} m`);
  },

  /** Like unhideAroundSelection, but PER selected leaf item: everything within
   *  the Fit Sel offset of ANY individual selected item unhides — good for
   *  scattered selections where one big bounds box would cover too much.
   *  Refused above 200 selected items (per-item boxes get expensive). */
  async unhideAroundEachSelected() {
    const MAX_ITEMS = 200;
    const n = await db.selectionCount();
    if (n === 0) {
      consoleActions.log('info', 'Selection → nothing selected, nothing to unhide around');
      return;
    }
    if (n > MAX_ITEMS) {
      consoleActions.log(
        'error',
        `Selection → ${n.toLocaleString()} items selected — Unhide Each works with at most ${MAX_ITEMS} (use Unhide Sel+Off. instead)`,
      );
      return;
    }
    const m = ribbonClippingBoxState.get().fitOffset;
    await viewerActions.unhideAroundSelectedItems(m);
    consoleActions.log('info', `Selection → unhid items within ${m} m of each of the ${n} selected item(s)`);
  },
};
