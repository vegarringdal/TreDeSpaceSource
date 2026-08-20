// Part of the scene↔viewpoint editor split (see viewpoints.state.ts): the
// normal Labels/Measurements panels swap to this banner while a viewpoint's
// sets are live; the "(viewpoint)" panels use ViewpointShell instead.
import { IconVolume } from '@tabler/icons-react';
import { PanelBody } from '@treDeSpaceUI/dockable';
import { Button, InfoBox } from '@treDeSpaceUI/widgets';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';

/** Shown INSTEAD of the scene Labels/Measurements editors while the viewpoint
 *  side is live. Unmute swaps the scene sets back (unsaved viewpoint edits
 *  prompt for saving first). */
export function SceneMutedBanner({ what }: { what: string }) {
  const s = viewpointsState.use();
  const vp = s.list.find((v) => v.id === s.activeId);
  return (
    <PanelBody className="panel-body flex flex-col gap-2 p-2">
      <InfoBox>
        Muted — the {what} of viewpoint <b>{vp?.name ?? '?'}</b> are live. Unmuting brings the scene {what} back and
        mutes the viewpoint editors (you are asked to save any unsaved viewpoint edits first).
      </InfoBox>
      <Button
        icon={<IconVolume size={14} />}
        tooltip={`Bring the scene ${what} back (mutes the viewpoint editors)`}
        shortcut="viewpoints.unmuteScene"
        onClick={() => void act.unmuteScene()}
      >
        Unmute scene
      </Button>
    </PanelBody>
  );
}
