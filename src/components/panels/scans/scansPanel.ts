// Opener registry for the dockable Scans panel.
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerScansOpener = opener.register;
export const openScansPanel = opener.call;
