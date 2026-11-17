import { PanelBody, useMinSize, usePanelContext } from '@treDeSpaceUI/dockable';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';
import { SceneMutedBanner } from '../viewpoints/SceneMutedBanner';
import { MeasurementsConfigSection } from './MeasurementsConfigSection';
import { MeasurementsFilesSection } from './MeasurementsFilesSection';
import { MeasurementsListSection } from './MeasurementsListSection';
import { useMeasurementsImport } from './useMeasurementsImport';

/** The Measurements list panel — rename / show / hide / delete each
 *  measurement, plus mute-all, clear, save/load (opened from the ribbon).
 *  While a viewpoint's measurements are live, the SCENE panel mutes (banner)
 *  and the same editor runs inside Measurements (viewpoint) instead. */
export function Measurements() {
  useMinSize(240, 200);
  const vps = viewpointsState.use();
  const ctx = usePanelContext();
  const { openPicker, pickerElement } = useMeasurementsImport();

  // the scene panel mutes while the viewpoint side is live — and vice versa
  if (ctx.id === 'measurements' && vps.liveSide === 'viewpoint') {
    return <SceneMutedBanner what="measurements" />;
  }

  return (
    <PanelBody className="panel-body flex flex-col gap-2 p-2">
      <MeasurementsFilesSection openPicker={openPicker} pickerElement={pickerElement} />
      <MeasurementsConfigSection />
      <MeasurementsListSection />
    </PanelBody>
  );
}
