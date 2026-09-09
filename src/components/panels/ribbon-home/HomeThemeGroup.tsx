import { IconMoon, IconSun } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { settingsActions } from '../settings/settings.actions';
import { settingsState } from '../settings/settings.state';

/** Theme — the light/dark toggle, last of the Home tab's own sections. */
export function HomeThemeGroup() {
  const dark = settingsState.use().theme === 'dark';

  return (
    <RibbonSection title="Theme">
      <RibbonButton
        icon={dark ? <IconSun /> : <IconMoon />}
        label={dark ? 'Light' : 'Dark'}
        tooltip={`Switch to the ${dark ? 'light' : 'dark'} theme`}
        shortcut="view.theme.toggle"
        onClick={settingsActions.toggleTheme}
      />
    </RibbonSection>
  );
}
