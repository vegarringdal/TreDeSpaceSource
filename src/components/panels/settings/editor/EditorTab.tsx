import { Button, Collapsible, ColorSelect } from '@treDeSpaceUI/widgets';
import { pickerSwatchesActions, pickerSwatchesState } from '../../../../state/pickerSwatches.state';
import { Check } from '../Check';
import { settingsActions } from '../settings.actions';
import { settingsState } from '../settings.state';

/** Settings → Editor tab: color-picker swatches + theme. */
export function EditorTab() {
  const s = settingsState.use();
  const pickerSwatches = pickerSwatchesState.use().colors;

  return (
    <Collapsible title="Editor">
      <div className="text-slate-400 text-xs">Color picker swatches</div>
      <div className="grid grid-cols-4 gap-1">
        {pickerSwatches.map((c, i) => (
          <ColorSelect
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed 8×4 grid
            key={i}
            value={c}
            onChange={(x) => pickerSwatchesActions.setColor(i, x)}
          />
        ))}
      </div>
      <div className="text-slate-500 text-xs">
        These are the quick swatches shown at the bottom of every color picker in the app.
      </div>
      <Button
        className="self-start"
        tooltip="Restore the default swatch palette"
        shortcut="editor.swatches.reset"
        onClick={() => pickerSwatchesActions.reset()}
      >
        Reset swatches
      </Button>
      <Check
        label="Use dark theme"
        checked={s.theme === 'dark'}
        shortcut="view.theme.toggle"
        onChange={(dark) => settingsActions.setTheme(dark ? 'dark' : 'light')}
      />
    </Collapsible>
  );
}
