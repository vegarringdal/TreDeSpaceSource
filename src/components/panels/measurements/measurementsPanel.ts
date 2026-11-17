// Registries that let the ribbon / global hotkeys reach the dockable
// Measurements panel: an opener (registered by App) and the Load file-picker
// trigger (registered by the panel while mounted).
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerMeasurementsOpener = opener.register;
export const openMeasurementsPanel = opener.call;

const load = makeCallbackSlot();
export const registerMeasurementsLoad = load.register;

/** Open the panel and pop the Load file picker (hotkey). The tiny delay lets
 *  the panel mount and register its trigger when it was closed. */
export function requestMeasurementsLoad() {
  opener.call();
  if (load.isSet()) {
    load.call();
  } else {
    setTimeout(() => load.call(), 60);
  }
}
