// Opener registry for the dockable SQL Reports panel.
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerSqlReportsOpener = opener.register;
export const openSqlReportsPanel = opener.call;

/** "Set editor" of the report being edited (hotkey; the editor owns the draft). */
const setEditor = makeCallbackSlot();
export const registerReportSetEditor = setEditor.register;
export const callReportSetEditor = setEditor.call;
