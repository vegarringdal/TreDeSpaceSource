// Opener registry for the dockable Model Assets panel.
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerModelAssetsOpener = opener.register;
export const openModelAssetsPanel = opener.call;
