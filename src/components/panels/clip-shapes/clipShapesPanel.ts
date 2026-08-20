// Registries for the dockable Clip Shapes panel — opener + Load file-picker
// trigger (same pattern as the Measurements panel).
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerClipShapesOpener = opener.register;
export const openClipShapesPanel = opener.call;

const load = makeCallbackSlot();
export const registerClipShapesLoad = load.register;

/** Open the panel and pop the Load file picker (hotkey). The tiny delay lets
 *  the panel mount and register its trigger when it was closed. */
export function requestClipShapesLoad() {
  opener.call();
  if (load.isSet()) {
    load.call();
  } else {
    setTimeout(() => load.call(), 60);
  }
}
