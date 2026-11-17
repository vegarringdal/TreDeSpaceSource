import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { Badge, Collapsible, EmptyState, InfoButton, PanelHeader } from '@treDeSpaceUI/widgets';
import { pointStatsState } from '../../../state/scans/pointStats.state';
import { PHOTO_SETTING_KEYS, POINT_SETTING_KEYS } from '../../../state/scans/scanSettings';
import { scansActions } from '../../../state/scans/scans.actions';
import { scansState } from '../../../state/scans/scans.state';
import { ScanControls } from './ScanControls';
import { ScanPointControls } from './ScanPointControls';
import { ScanSettingsReset } from './ScanSettingsReset';
import { ScanSetupList } from './ScanSetupList';

/** Floor of the scan list's own scroll area: below it the panel scrolls. */
const LIST_MIN_HEIGHT = 'min-h-56';

const fmtPoints = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n.toLocaleString());

/** Laser scans in one place: the point cloud, the scanner setups, and the
 *  photo of the setup the camera is inside — shown alone or blended with the
 *  model and the points. */
export function Scans() {
  // -----------------------------------------------------------------------------
  // Hooks
  // -----------------------------------------------------------------------------

  useMinSize(240, 260);
  const { assets, setups, active } = scansState.use();
  const { drawn } = pointStatsState.use();

  // -----------------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------------

  const inside = setups.find((s) => s.key === active);
  const photos = setups.filter((s) => s.hasPanorama).length;

  // -----------------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------------

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
      <PanelHeader
        title="Scans"
        aside={setups.length > 0 ? <Badge>{setups.length} scan spheres</Badge> : undefined}
        actions={
          <InfoButton label="About scans">
            Import a Leica <code>.lgsx</code>, an <code>.e57</code> or a cooked <code>.tdpp</code> in the Import Manager
            and load it from Model Assets. The <b>points</b> stream in by distance, finest where the camera looks. Each
            place the scanner stood is a <b>scan sphere</b>, orange in the scene: double-click one (or Enter here) to
            stand at the scanner and see its <b>photo</b> — drag to look around, the wheel zooms. Lower the photo
            opacity to blend it with the model and the points, and compare as-built with as-designed.
          </InfoButton>
        }
      />
      {assets.length === 0 ? (
        <EmptyState layout="center">
          No laser scan loaded — import one in the Import Manager, then load it from Model Assets.
        </EmptyState>
      ) : (
        <>
          <Collapsible
            title="Point cloud"
            aside={`${fmtPoints(drawn)} drawn`}
            actions={
              <ScanSettingsReset
                label="the point cloud settings"
                keys={POINT_SETTING_KEYS}
                shortcut="scans.points.reset"
                onReset={scansActions.resetPointSettings}
              />
            }
          >
            <ScanPointControls />
          </Collapsible>
          <Collapsible
            title="Photo"
            aside={inside ? `inside ${inside.label}` : 'not inside a scan sphere'}
            actions={
              <ScanSettingsReset
                label="the photo settings"
                keys={PHOTO_SETTING_KEYS}
                shortcut="scans.photo.reset"
                onReset={scansActions.resetPhotoSettings}
              />
            }
          >
            <ScanControls />
          </Collapsible>
          <Collapsible
            title="Scans and scan spheres"
            aside={`${assets.length} loaded · ${photos} photos`}
            fill
            fillMinClass={LIST_MIN_HEIGHT}
          >
            <ScanSetupList />
          </Collapsible>
        </>
      )}
    </PanelBody>
  );
}
