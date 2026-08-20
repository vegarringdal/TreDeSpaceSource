import { PanelBody, useMinSize, usePanelContext } from '@treDeSpaceUI/dockable';
import { InfoBox } from '@treDeSpaceUI/widgets';
import { labelsState } from '../../../state/viewer/labels.state';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';
import { SceneMutedBanner } from '../viewpoints/SceneMutedBanner';
import { LabelsCommonSection } from './LabelsCommonSection';
import { LabelsImportSection } from './LabelsImportSection';
import { LabelsListSection } from './LabelsListSection';
import { LabelsStyleSection } from './LabelsStyleSection';

/** Labels panel: place/import world-anchored text labels, style them and
 *  manage selection. Placement, drag and ctrl+select live in the viewport.
 *  While a viewpoint's labels are live, the SCENE panel mutes (banner) and
 *  the same editor runs inside Labels (viewpoint) instead. */
export function Labels() {
  useMinSize(260, 260);
  const vps = viewpointsState.use();
  const s = labelsState.use();
  const ctx = usePanelContext();

  // the scene panel mutes while the viewpoint side is live — and vice versa
  // (after every hook: the banner return must not change hook order)
  if (ctx.id === 'labels' && vps.liveSide === 'viewpoint') {
    return <SceneMutedBanner what="labels" />;
  }

  return (
    <PanelBody className="panel-body flex flex-col gap-1.5 overflow-y-auto p-2">
      {s.muted && (
        <InfoBox>
          Labels are muted — they are hidden in the viewport but still here. Press Show all to bring them back.
        </InfoBox>
      )}
      <LabelsCommonSection />
      <LabelsStyleSection />
      <LabelsImportSection />
      <LabelsListSection />
    </PanelBody>
  );
}
