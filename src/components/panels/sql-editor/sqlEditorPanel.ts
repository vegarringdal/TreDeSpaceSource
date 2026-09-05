// Opener + action registry for the dockable SQL Editor panel.
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerSqlEditorOpener = opener.register;
export const openSqlEditorPanel = opener.call;

/** Open the SQL Editor docked to the RIGHT of the viewport — the host API's
 *  placement (`sql.editor`); an already-open editor is focused where it is. */
const besideViewport = makeCallbackSlot();
export const registerSqlEditorViewportOpener = besideViewport.register;
export const openSqlEditorPanelBesideViewport = besideViewport.call;

/** Run the editor's SQL (hotkey; the panel owns the text). */
const runner = makeCallbackSlot();
export const registerSqlRun = runner.register;
export const callSqlRun = runner.call;
