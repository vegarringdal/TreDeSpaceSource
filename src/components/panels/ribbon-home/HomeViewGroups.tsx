import { IconCube, IconMoon, IconPencil, IconPerspective, IconSun } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { viewerState } from '../../../state/viewer/viewer.state';
import { settingsActions } from '../settings/settings.actions';
import { settingsState } from '../settings/settings.state';
import { ribbonHomeActions as act } from './ribbonHome.actions';
import { ribbonHomeState } from './ribbonHome.state';

/** Theme/sketch view toggles and the perspective/ortho camera mode switch. */
export function HomeViewGroups() {
  const s = ribbonHomeState.use();
  const dark = settingsState.use().theme === 'dark';
  const sketch = viewerState.use().sketch;

  return (
    <>
      <RibbonSection title="View">
        <RibbonButton
          icon={dark ? <IconSun /> : <IconMoon />}
          label={dark ? 'Light' : 'Dark'}
          tooltip={`Switch to the ${dark ? 'light' : 'dark'} theme`}
          shortcut="view.theme.toggle"
          onClick={settingsActions.toggleTheme}
        />
        <RibbonButton
          icon={<IconPencil />}
          label="Sketch"
          selected={sketch}
          tooltip="Sketch mode: white background with black edge lines only (labels/measurements stay visible; screenshots capture the sketch look). Transparent items are not included — they produce no edges."
          shortcut="view.sketch"
          onClick={() => viewerState.set({ sketch: !sketch })}
        />
      </RibbonSection>

      <RibbonSection title="Camera Mode">
        <RibbonButton
          icon={<IconPerspective />}
          label="Persp."
          selected={s.camera === 'persp'}
          shortcut="camera.persp"
          onClick={() => act.setCamera('persp')}
        />
        <RibbonButton
          icon={<IconCube />}
          label="Ortho"
          selected={s.camera === 'ortho'}
          shortcut="camera.ortho"
          onClick={() => act.setCamera('ortho')}
        />
      </RibbonSection>
    </>
  );
}
