import { IconCamera, IconDatabase, IconPackageImport, IconStack2, IconTrash } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { openImportManagerPanel } from '../import-manager/importManagerPanel';
import { openModelAssetsPanel } from '../model-assets/modelAssetsPanel';
import { openSqlAssetsPanel } from '../sql-assets/sqlAssetsPanel';
import { ribbonHomeActions as act } from './ribbonHome.actions';

/** Asset library/import panel openers and the canvas clear/screenshot pair. */
export function HomeAssetsGroups() {
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
      </RibbonSection>
    </>
  );
}
