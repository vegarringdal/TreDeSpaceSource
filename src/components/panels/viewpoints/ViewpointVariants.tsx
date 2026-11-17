// The "(viewpoint)" editor panels: the SAME editors as Labels / Measurements /
// Set Color, bound to the active viewpoint. Labels and Measurements edit live
// (mute-swap; see viewpoints.state.ts) under a Save-to-viewpoint banner; Set
// Color binds the editor to the viewpoint's own rules store — no mute needed.

import { PanelBody } from '@treDeSpaceUI/dockable';
import { cn } from '@treDeSpaceUI/lib/cn';
import { InfoBox } from '@treDeSpaceUI/widgets';
import { viewpointRulesActions, viewpointRulesDirty } from '../../../state/viewer/viewpoints.actions';
import { viewpointRulesState, viewpointsState } from '../../../state/viewer/viewpoints.state';
import { Labels } from '../labels/Labels';
import { Measurements } from '../measurements/Measurements';
import { MultiColor, MultiColorProvider } from '../multi-color/MultiColor';
import { ViewpointEditBar } from './ViewpointEditBar';
import { ViewpointShell } from './ViewpointShell';

export function LabelsViewpoint() {
  return (
    <ViewpointShell what="labels">
      <Labels />
    </ViewpointShell>
  );
}

export function MeasurementsViewpoint() {
  return (
    <ViewpointShell what="measurements">
      <Measurements />
    </ViewpointShell>
  );
}

/** Set Color bound to the active viewpoint's rules (run on activation).
 *  Trigger-based — no mute swap, both Set Color panels can be open at once.
 *  Edits stay in the editor until Save-to-viewpoint commits them. */
export function MultiColorViewpoint() {
  const s = viewpointsState.use();
  viewpointRulesState.use(); // dirty highlight tracks every rule edit
  const vp = s.list.find((v) => v.id === s.activeId);
  if (!vp) {
    return (
      <PanelBody className="panel-body p-2">
        <InfoBox>No active viewpoint — activate one in the Viewpoints panel first.</InfoBox>
      </PanelBody>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewpointEditBar
        label={
          <>
            Rules of <b>{vp.name}</b> — run when the viewpoint activates
          </>
        }
        dirty={viewpointRulesDirty(vp)}
      />
      {/* locked (view mode) until Edit: inert blocks clicks AND focus */}
      <div className={cn('min-h-0 flex-1', !s.editing && 'pointer-events-none opacity-60')} inert={!s.editing}>
        <MultiColorProvider value={{ store: viewpointRulesState, act: viewpointRulesActions }}>
          <MultiColor />
        </MultiColorProvider>
      </div>
    </div>
  );
}
