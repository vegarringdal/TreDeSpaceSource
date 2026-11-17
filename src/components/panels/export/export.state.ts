import { createStore } from '@treDeSpaceUI/lib/createStore';
import { storageKey } from '../../../lib/storageKeys';

/** Export panel options — persisted like every other settings store. */
export interface ExportState {
  /** Keep the app's Z-up axes (skip the glTF Y-up conversion root). */
  zUp: boolean;
  /** Shift the model onto its bounding-box centre so far-from-origin building
   *  coordinates stay f32-precise (Office viewers go crazy far from 0,0,0). */
  recenter: boolean;
  /** Leave out items that lie entirely outside the active clipping planes /
   *  box / shapes (TDP, GLB and IFC alike); an intersected item is kept whole. */
  excludeClipped: boolean;
  /** Snapshot save: only items with an override/hidden flag/transform, or
   *  every item's effective state. */
  snapModifiedOnly: boolean;
  /** Snapshot save channels. */
  snapColor: boolean;
  snapTransform: boolean;
  /** Snapshot save filters: drop opaque-white colors / the hidden flag. */
  snapSkipWhite: boolean;
  snapSkipHidden: boolean;
  /** Save only this store's models ('' = every store). */
  snapStore: string;
  /** Snapshot load channels (filter what the file contains). */
  snapApplyColor: boolean;
  snapApplyTransform: boolean;
  /** Snapshot load filters: ignore white colors / hidden state in the file. */
  snapApplySkipWhite: boolean;
  snapApplySkipHidden: boolean;
  /** Apply only onto this store's models ('' = every store). */
  snapApplyStore: string;
}

const KEY = storageKey('export');

function load(): ExportState {
  const fallback: ExportState = {
    zUp: false,
    recenter: true,
    excludeClipped: false,
    snapModifiedOnly: true,
    snapColor: true,
    snapTransform: true,
    snapSkipWhite: false,
    snapSkipHidden: false,
    snapStore: '',
    snapApplyColor: true,
    snapApplyTransform: true,
    snapApplySkipWhite: false,
    snapApplySkipHidden: false,
    snapApplyStore: '',
  };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<ExportState>) } : fallback;
  } catch {
    return fallback;
  }
}

export const exportState = createStore<ExportState>(load());

exportState.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(exportState.get()));
  } catch {
    // storage unavailable — non-fatal
  }
});
