import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerExportOpener = opener.register;
export const openExportPanel = opener.call;

// the snapshot Load file-picker trigger, registered while the panel is mounted
const snapshotLoad = makeCallbackSlot();
export const registerSnapshotLoad = snapshotLoad.register;

/** Open the Export panel and pop the snapshot Load picker (hotkey). The tiny
 *  delay lets the panel mount and register its trigger when it was closed. */
export function requestSnapshotLoad() {
  opener.call();
  if (snapshotLoad.isSet()) {
    snapshotLoad.call();
  } else {
    setTimeout(() => snapshotLoad.call(), 60);
  }
}
