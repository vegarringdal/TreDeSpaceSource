// Opener + action registry for the dockable SQL Editor panel.
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerSqlEditorOpener = opener.register;
export const openSqlEditorPanel = opener.call;

/** Run the editor's SQL (hotkey; the panel owns the text). */
const runner = makeCallbackSlot();
export const registerSqlRun = runner.register;
export const callSqlRun = runner.call;
