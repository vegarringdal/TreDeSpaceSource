import { cn } from '@treDeSpaceUI/lib/cn';
import { InfoBox } from '@treDeSpaceUI/widgets';
import type { Viewpoint } from '../../../state/viewer/viewpoints.state';
import { RichText } from '../../shared/RichText';
import { VIEWER_DESCRIPTION, VIEWER_ROW_ACTIVE } from './viewpointViewerStyles';

/** One-at-a-time view: only the active viewpoint — its full name (wrapped,
 *  never cut) and its description. The arrows in the top row step on. */
export function ViewpointViewerSingle({ viewpoint }: { viewpoint: Viewpoint | null }) {
  if (!viewpoint) {
    return (
      <div className="min-h-0 flex-1">
        <InfoBox>No viewpoint is active — press the next arrow to start with the first one.</InfoBox>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className={cn('break-words border px-2 py-1.5 text-xs', VIEWER_ROW_ACTIVE)}>{viewpoint.name}</div>
      {viewpoint.description.trim().length > 0 && (
        <RichText block text={viewpoint.description} className={VIEWER_DESCRIPTION} />
      )}
    </div>
  );
}
