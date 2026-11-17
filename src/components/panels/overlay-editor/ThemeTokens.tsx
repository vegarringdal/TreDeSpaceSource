import { ColorSelect } from '@treDeSpaceUI/widgets';
import { DEFAULT_TOKENS } from '../../../lib/overlay/overlayStyle';
import type { OverlayTheme } from '../../../lib/overlay/overlayTypes';
import { overlayLibraryActions } from '../../../state/overlayComponents/overlayComponents.actions';

/** A theme's colour tokens ($bg, $accent, …) — preset themes are copied on
 *  the first edit so the shipped ones stay as they are. */
export function ThemeTokens({ theme }: { theme: OverlayTheme }) {
  const tokens = { ...DEFAULT_TOKENS, ...theme.tokens };

  const set = (key: string, color: string) => {
    const next = { ...theme, tokens: { ...tokens, [key]: color } };
    overlayLibraryActions.saveTheme(
      theme.id.startsWith('theme.') ? { ...next, id: `${theme.id}.mine`, name: `${theme.name} (mine)` } : next,
    );
  };

  return (
    <div className="grid grid-cols-2 gap-1">
      {Object.entries(tokens).map(([k, v]) => (
        <ColorSelect
          tooltip={`Theme colour $${k}`}
          key={k}
          label={`$${k}`}
          labelPosition="left"
          labelWidth={64}
          value={v}
          onChange={(c) => set(k, c)}
        />
      ))}
    </div>
  );
}
