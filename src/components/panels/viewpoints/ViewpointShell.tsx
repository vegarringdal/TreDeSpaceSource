// Part of the scene↔viewpoint editor split (see viewpoints.state.ts): the
// "(viewpoint)" panels wrap their editor in this shell, which gates on an
// active viewpoint + the viewpoint side being live and carries the
// Edit → Save-to-viewpoint bar; the scene panels show SceneMutedBanner.
import { IconVolumeOff } from '@tabler/icons-react';
import { PanelBody } from '@treDeSpaceUI/dockable';
import { cn } from '@treDeSpaceUI/lib/cn';
import { Button, InfoBox } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import { labelsState } from '../../../state/viewer/labels.state';
import { measurementsState } from '../../../state/viewer/measurements.state';
import {
  viewpointsActions as act,
  viewpointRulesDirty,
  viewpointSetsDirty,
} from '../../../state/viewer/viewpoints.actions';
import { viewpointRulesState, viewpointsState } from '../../../state/viewer/viewpoints.state';
import { ViewpointEditBar } from './ViewpointEditBar';

/** Wrapper for the "(viewpoint)" Labels/Measurements panels: gates on an
 *  active viewpoint + the viewpoint side being live, then renders the normal
 *  editor under the Edit → Save bar. */
export function ViewpointShell({ what, children }: { what: string; children: ReactNode }) {
  const s = viewpointsState.use();
  // subscribe to the live editors so the dirty highlight tracks every edit
  labelsState.use();
  measurementsState.use();
  viewpointRulesState.use();
  const vp = s.list.find((v) => v.id === s.activeId);
  if (!vp) {
    return (
      <PanelBody className="panel-body p-2">
        <InfoBox>No active viewpoint — activate one in the Viewpoints panel first.</InfoBox>
      </PanelBody>
    );
  }
  if (s.liveSide !== 'viewpoint') {
    return (
      <PanelBody className="panel-body flex flex-col gap-2 p-2">
        <InfoBox>
          Muted — the scene {what} are live. Unmute to edit the {what} of viewpoint <b>{vp.name}</b> (the scene panels
          mute in turn).
        </InfoBox>
        <Button
          icon={<IconVolumeOff size={14} />}
          tooltip={`Show and edit this viewpoint's ${what} (mutes the scene panels)`}
          shortcut="viewpoints.unmuteViewpoint"
          onClick={() => act.unmuteViewpoint()}
        >
          Unmute viewpoint
        </Button>
      </PanelBody>
    );
  }
  const dirty = viewpointSetsDirty(vp) || viewpointRulesDirty(vp);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewpointEditBar
        label={
          <>
            {s.editing ? 'Editing' : 'Viewing'} <b>{vp.name}</b>
          </>
        }
        dirty={dirty}
      />
      {/* locked (view mode) until Edit: inert blocks clicks AND focus */}
      <div className={cn('min-h-0 flex-1', !s.editing && 'pointer-events-none opacity-60')} inert={!s.editing}>
        {children}
      </div>
    </div>
  );
}
