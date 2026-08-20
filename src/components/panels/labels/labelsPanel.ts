import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerLabelsOpener = opener.register;
export const openLabelsPanel = opener.call;

// the Load file-picker trigger, registered by the panel while it is mounted
const load = makeCallbackSlot();
export const registerLabelsLoad = load.register;

/** Open the panel and pop the Load file picker (hotkey). The tiny delay lets
 *  the panel mount and register its trigger when it was closed. */
export function requestLabelsLoad() {
  opener.call();
  if (load.isSet()) {
    load.call();
  } else {
    setTimeout(() => load.call(), 60);
  }
}
