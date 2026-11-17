import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { StorageStatus } from '../../lib/opfs/storageSpace';

/** What the browser last reported about this origin's storage (Settings →
 *  Storage). Read by the tab; refreshed by the actions module, which the
 *  import path and a hotkey also call. */
export interface StorageState {
  /** null = not read yet, or the browser cannot say. */
  status: StorageStatus | null;
  /** The browser has been asked at least once since the page loaded. */
  isReady: boolean;
}

export const storageState = createStore<StorageState>({ status: null, isReady: false });
