import { ridesOn } from '../../../lib/transform/pose';
import { fromTransformActions } from '../../../state/animation/fromTransform.actions';
import { transformState } from '../../../state/transform/transform.state';
import { transformObjectsUiState } from './transformObjectsUi.state';

function setOpen(ids: readonly string[], open: boolean): void {
  const next = { ...transformObjectsUiState.get().open };
  for (const id of ids) {
    next[id] = open;
  }
  transformObjectsUiState.set({ open: next });
}

/** The objects riding on `id`, through any number of parents. */
function subObjects(id: string): string[] {
  const objects = transformState.get().objects;
  return objects.filter((o) => ridesOn(objects, o.id, id)).map((o) => o.id);
}

/** The Transform Objects panel's own actions: open / close rows, and To
 *  animation with the panel's sub-objects choice. */
export const transformObjectsUiActions = {
  setOpen(id: string, open: boolean): void {
    setOpen([id], open);
  },

  /** Open or close every row (Expand all / Collapse all). */
  setAllOpen(open: boolean): void {
    setOpen(
      transformState.get().objects.map((o) => o.id),
      open,
    );
  },

  /** The rows of the sub-objects of `id`: closed when any is open, else
   *  opened. */
  toggleSubObjects(id: string): void {
    const ids = subObjects(id);
    const open = transformObjectsUiState.get().open;
    setOpen(ids, !ids.some((x) => open[x]));
  },

  /** Whether To animation takes sub-objects along. */
  setWithSubObjects(on: boolean): void {
    transformObjectsUiState.set({ withSubObjects: on });
  },

  toggleWithSubObjects(): void {
    transformObjectsUiState.set({ withSubObjects: !transformObjectsUiState.get().withSubObjects });
  },

  /** The object as an animation object of the active scene (To animation),
   *  with its sub-objects when that is on. */
  toAnimation(id: string): void {
    void fromTransformActions.add(id, transformObjectsUiState.get().withSubObjects);
  },

  /** The same for the current object (hotkey). */
  currentToAnimation(): void {
    const id = transformState.get().currentId;
    if (id) {
      transformObjectsUiActions.toAnimation(id);
    }
  },

  /** Open or close the rows of every sub-object of `id` (the container's
   *  own Expand all / Collapse all). */
  setSubObjectsOpen(id: string, open: boolean): void {
    setOpen(subObjects(id), open);
  },

  /** The same for the current object (hotkeys); `open` absent = toggle. */
  toggleCurrentSubObjects(open?: boolean): void {
    const id = transformState.get().currentId;
    if (!id) {
      return;
    }
    if (open === undefined) {
      transformObjectsUiActions.toggleSubObjects(id);
    } else {
      transformObjectsUiActions.setSubObjectsOpen(id, open);
    }
  },
};
