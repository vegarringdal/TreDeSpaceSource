import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerMultiColorOpener = opener.register;
export const openMultiColorPanel = opener.call;
