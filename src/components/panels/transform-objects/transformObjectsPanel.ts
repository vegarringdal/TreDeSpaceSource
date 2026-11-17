// Registries that let the ribbon / global hotkeys reach the dockable
// Transform Objects panel: an opener (registered by App) and the Load
// file-picker trigger (registered by the panel while mounted).
import { makeCallbackSlot } from '../panelRegistry';

/** The panel mounts a moment after it is opened; its picker registers then. */
const MOUNT_WAIT_MS = 60;

const opener = makeCallbackSlot();
export const registerTransformObjectsOpener = opener.register;
export const openTransformObjectsPanel = opener.call;

const load = makeCallbackSlot();
export const registerTransformObjectsLoad = load.register;

/** Open the panel and pop the Load file picker (hotkey). */
export function requestTransformObjectsLoad(): void {
  opener.call();
  if (load.isSet()) {
    load.call();
  } else {
    setTimeout(() => load.call(), MOUNT_WAIT_MS);
  }
}
