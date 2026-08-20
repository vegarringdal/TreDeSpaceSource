// Opener registry for the dockable Import Manager panel.
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerImportManagerOpener = opener.register;
export const openImportManagerPanel = opener.call;
