import { makeCallbackSlot } from '../panelRegistry';

// The preview's effect replay lives in the preview component (local
// animation state); the hotkey reaches it through this slot.
const replay = makeCallbackSlot();
export const registerOverlayPreviewReplay = replay.register;
export const replayOverlayPreview = replay.call;
