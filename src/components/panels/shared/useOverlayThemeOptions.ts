import { autoTheme } from '../../../lib/overlay/overlayPresets';
import { overlayLibraryState } from '../../../state/overlayComponents/overlayComponents.state';
import { settingsState } from '../settings/settings.state';

/** The picker value of Auto (no theme) — never a theme id. */
const AUTO = '__auto';

/** An overlay theme picker's options: Auto first (follows the app's light /
 *  dark theme — named after what it is now), then the library's themes; and
 *  the conversions between a stored theme (null = Auto) and a picker value. */
export function useOverlayThemeOptions(): {
  options: { value: string; label: string; tooltip?: string }[];
  toValue: (theme: string | null | undefined) => string;
  fromValue: (value: string | null) => string | null;
} {
  const themes = overlayLibraryState.useSelect((s) => s.themes);
  const app = settingsState.useSelect((s) => s.theme);
  return {
    options: [
      {
        value: AUTO,
        label: `Auto (${autoTheme(app, themes).name} now)`,
        tooltip: "Follows the app's theme: Light in the light theme, Dark in the dark one",
      },
      ...themes.map((t) => ({ value: t.id, label: t.name })),
    ],
    toValue: (theme) => theme ?? AUTO,
    fromValue: (value) => (value === null || value === AUTO ? null : value),
  };
}
