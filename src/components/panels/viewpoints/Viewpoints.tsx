// Viewpoints panel: capture, edit and activate named scene viewpoints
// (camera + clipping + labels + measurements + color rules + selection).
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { InfoBox } from '@treDeSpaceUI/widgets';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';
import { ViewpointEditorList } from './ViewpointEditorList';
import { ViewpointsToolbar } from './ViewpointsToolbar';

/** Viewpoints: named snapshots of the whole view — camera, clipping, labels,
 *  measurements, color rules and a selection — activated with one click. The
 *  button row stays on top; the list scrolls under it. */
export function Viewpoints() {
  useMinSize(300, 300);
  const s = viewpointsState.use();

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-1.5 p-2">
      <ViewpointsToolbar hasViewpoints={s.list.length > 0} bookmarkButton={s.bookmarkButton} />
      {s.list.length === 0 && (
        <InfoBox>
          No viewpoints yet — set up the camera and clipping and press Add viewpoint, then use the Get buttons to bring
          the main panels' colors, labels and measurements in.
        </InfoBox>
      )}
      {s.list.length > 0 && <ViewpointEditorList list={s.list} activeId={s.activeId} selectedId={s.selectedId} />}
    </PanelBody>
  );
}
