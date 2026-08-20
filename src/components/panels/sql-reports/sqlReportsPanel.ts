// Opener registry for the dockable SQL Reports panel.
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerSqlReportsOpener = opener.register;
export const openSqlReportsPanel = opener.call;
