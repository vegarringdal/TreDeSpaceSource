import {
  IconCamera,
  IconCube,
  IconDatabase,
  IconMoon,
  IconPackageImport,
  IconPerspective,
  IconStack2,
  IconSun,
  IconTrash,
  IconTrashX,
} from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { openImportManagerPanel } from '../import-manager/importManagerPanel';
import { openModelAssetsPanel } from '../model-assets/modelAssetsPanel';
import { settingsActions } from '../settings/settings.actions';
import { settingsState } from '../settings/settings.state';
import { openSqlAssetsPanel } from '../sql-assets/sqlAssetsPanel';
import { ribbonHomeActions as act } from './ribbonHome.actions';
import { ribbonHomeState } from './ribbonHome.state';

/** Assets: the library/import panel openers plus the wipe-everything local
 *  reset. Canvas: clear/screenshot, the perspective/ortho camera switch and
 *  the light/dark theme toggle. */
export function HomeAssetsGroups() {
  const { camera } = ribbonHomeState.use();
  const dark = settingsState.use().theme === 'dark';

  return (
    <>
      <RibbonSection title="Assets">
        <RibbonButton
          icon={<IconStack2 />}
          label="Model"
          tooltip="Open the Model Assets library (imported models in the browser)"
          shortcut="home.assets"
          onClick={() => openModelAssetsPanel()}
        />
        <RibbonButton
          icon={<IconPackageImport />}
          label="Import"
          tooltip="Open the Import Manager (bring models into the library)"
          shortcut="home.importManager"
          onClick={() => openImportManagerPanel()}
        />
        <RibbonButton
          icon={<IconDatabase />}
          label="SQL"
          tooltip="Open the SQL Assets library (SQLite databases per store)"
          shortcut="sql.assets"
          onClick={() => openSqlAssetsPanel()}
        />
        <RibbonButton
          icon={<IconTrashX />}
          label="Wipe all"
          tooltip="Wipe ALL locally saved data — settings, layout, hotkeys, viewpoints, rules AND every imported asset — then reload"
          shortcut="home.wipe.all"
          onClick={() => void act.wipeAllLocal()}
        />
      </RibbonSection>

      <RibbonSection title="Canvas">
        <RibbonButton
          icon={<IconTrash />}
          label="Clear"
          tooltip="Unload every loaded asset and clear the canvas"
          shortcut="home.remove"
          onClick={act.remove}
        />
        <RibbonButton
          icon={<IconCamera />}
          label="Screenshot"
          tooltip="Download the current viewport as a PNG (includes the view cube)"
          shortcut="home.screenshot"
          onClick={() => void act.screenshot()}
        />
        <RibbonButton
          icon={<IconPerspective />}
          label="Persp."
          selected={camera === 'persp'}
          shortcut="camera.persp"
          onClick={() => act.setCamera('persp')}
        />
        <RibbonButton
          icon={<IconCube />}
          label="Ortho"
          selected={camera === 'ortho'}
          shortcut="camera.ortho"
          onClick={() => act.setCamera('ortho')}
        />
        <RibbonButton
          icon={dark ? <IconSun /> : <IconMoon />}
          label={dark ? 'Light' : 'Dark'}
          tooltip={`Switch to the ${dark ? 'light' : 'dark'} theme`}
          shortcut="view.theme.toggle"
          onClick={settingsActions.toggleTheme}
        />
      </RibbonSection>
    </>
  );
}
