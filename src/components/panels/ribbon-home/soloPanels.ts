// Opener registry: Home → "Solo" toggles all unlocked panels except the main
// one closed / restored (DockManager.toggleSolo).
import { makeCallbackSlot } from '../panelRegistry';

const slot = makeCallbackSlot();
export const registerSoloToggle = slot.register;
export const toggleSoloPanels = slot.call;

// Kiosk: viewport-only (solo + collapsed ribbon) — for iframe hosting and a
// distraction-free view in the normal app (hotkey view.kiosk).
const kiosk = makeCallbackSlot();
export const registerKioskToggle = kiosk.register;
export const toggleKiosk = kiosk.call;
