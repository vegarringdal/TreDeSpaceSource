// Viewpoint Viewer: the simplified presentation panel — the previous / next
// arrows and the position on top, the viewpoint names (or only the active one) with the
// active one's description in the middle, and Load plus the quick mute
// toggles for labels/measurements fixed at the bottom.
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { InfoBox } from '@treDeSpaceUI/widgets';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';
import { viewpointViewerState } from '../../../state/viewer/viewpointViewer.state';
import { ViewpointViewerFooter } from './ViewpointViewerFooter';
import { ViewpointViewerList } from './ViewpointViewerList';
import { ViewpointViewerNav } from './ViewpointViewerNav';
import { ViewpointViewerSingle } from './ViewpointViewerSingle';

/** Minimal viewpoint list for reviewing/presenting — no editing. */
export function ViewpointViewer() {
  useMinSize(200, 160);
  const { list, activeId } = viewpointsState.use();
  const { oneAtATime } = viewpointViewerState.use();
  const activeIndex = list.findIndex((vp) => vp.id === activeId);

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-1.5 p-2">
      <ViewpointViewerNav activeIndex={activeIndex} count={list.length} oneAtATime={oneAtATime} />
      {list.length === 0 && (
        <div className="min-h-0 flex-1">
          <InfoBox>No viewpoints — create them in the Viewpoints panel.</InfoBox>
        </div>
      )}
      {list.length > 0 && oneAtATime && <ViewpointViewerSingle viewpoint={list[activeIndex] ?? null} />}
      {list.length > 0 && !oneAtATime && <ViewpointViewerList list={list} activeIndex={activeIndex} />}
      <ViewpointViewerFooter />
    </PanelBody>
  );
}
