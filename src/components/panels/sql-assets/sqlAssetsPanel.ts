// Opener registry for the dockable SQL Assets panel.
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerSqlAssetsOpener = opener.register;
export const openSqlAssetsPanel = opener.call;

/** Panel-local "Import Database" (the file picker lives in the panel). */
const importer = makeCallbackSlot();
export const registerSqlImport = importer.register;
export const callSqlImport = importer.call;
