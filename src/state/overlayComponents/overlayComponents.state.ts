import { createStore } from '@treDeSpaceUI/lib/createStore';
import { OVERLAY_PRESETS, OVERLAY_THEME_PRESETS } from '../../lib/overlay/overlayPresets';
import type { OverlayComponent, OverlayTheme } from '../../lib/overlay/overlayTypes';

/** The user's overlay component + theme library (DESIGN.md › Animation,
 *  D14): per user, persisted in OPFS by overlayComponents.actions.ts. Starts
 *  as the shipped presets; the load merges the saved copies over them. */
export interface OverlayLibraryState {
  components: OverlayComponent[];
  themes: OverlayTheme[];
  loaded: boolean;
}

export const overlayLibraryState = createStore<OverlayLibraryState>({
  components: [...OVERLAY_PRESETS],
  themes: [...OVERLAY_THEME_PRESETS],
  loaded: false,
});
