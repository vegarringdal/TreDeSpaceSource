import { createStore } from '@treDeSpaceUI/lib/createStore';

/** Temporary isolate (Hierarchy toolbar + hotkey): on while the model worker
 *  holds what to put back. Changed only through viewerActions
 *  (toggleTempIsolate / syncTempIsolate). */
export const tempIsolateState = createStore<{ isActive: boolean }>({ isActive: false });
