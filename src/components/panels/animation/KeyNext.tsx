import { IconArrowBackUp, IconKey } from '@tabler/icons-react';
import { Button, EasingSelect, RotationInput, TimeInput, Vec3Input } from '@treDeSpaceUI/widgets';
import { INTERP_OPTIONS } from '../../../lib/animation/interpOptions';
import { choiceOf } from '../../../lib/animation/pivots';
import type { AnimObject } from '../../../lib/animation/types';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { playerState } from '../../../state/animation/player.state';
import { posingActions } from '../../../state/animation/posing.actions';
import { sessionRestBounds } from '../../../state/animation/runtime';
import { ribbonSelectionTransformState } from '../ribbon-selection-transform/ribbonSelectionTransform.state';
import { InspectorFrame } from './InspectorFrame';
import { KeyFromHere } from './KeyFromHere';
import { PivotFields } from './PivotFields';

const LABEL_W = 56;

/** The next key of an object: where it is at the time slider (as dragged
 *  or typed), how it will arrive — Key keys it. */
export function KeyNext({ object }: { object: AnimObject }) {
  const posing = animationUiState.useSelect((s) => s.posing);
  // the time slider and every pose change re-read the preview
  playerState.useSelect((s) => s.time);
  // the gizmo's pivot moving writes the next key's offset: re-read then
  ribbonSelectionTransformState.useSelect((s) => s.pivot);
  const nextPivot = animationUiState.useSelect((s) => s.nextPivot);
  // Key keys every posed object, else every object the selection names
  const keyed = animationUiState.useSelect((s) => s.posing?.objects.length ?? s.objectSelection.length);
  const next = posingActions.nextKey(object.id);
  if (!next) {
    return null;
  }
  const posed = posing?.objects.includes(object.id) ?? false;
  const others = keyed > 1 ? ` +${keyed - 1}` : '';

  const actions = (
    <Button
      size="sm"
      icon={<IconKey />}
      tooltip="Key the pose at the time slider (I)"
      shortcut="animation.addKey"
      onClick={() => void posingActions.key()}
    >
      Key
    </Button>
  );

  return (
    <InspectorFrame
      kind="Next key"
      name={`${object.name || 'Object'}${others} · ${next.time.toFixed(2)} s`}
      actions={actions}
    >
      <TimeInput
        label="Time"
        tooltip="Where the next key goes (s): the time slider moves, the pose goes along"
        labelPosition="left"
        labelWidth={LABEL_W}
        value={next.time}
        onChange={(t) => void posingActions.movePoseTo(t)}
      />
      <Vec3Input
        label="Move"
        labelWidth={LABEL_W}
        value={next.move}
        step={0.05}
        unit="m"
        tooltips={['X from its place (m)', 'Y from its place (m)', 'Z from its place (m)']}
        onChange={(move) => void posingActions.setPoseValues({ move }, object.id)}
      />
      <RotationInput
        label="Rotate"
        labelWidth={LABEL_W}
        value={next.rotate}
        onChange={(rotate) => void posingActions.setPoseValues({ rotate }, object.id)}
      />
      <PivotFields
        choice={nextPivot ?? choiceOf(next.pivot, sessionRestBounds(object.id))}
        onChange={posingActions.setNextPivot}
      />
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>Arrives</span>
        <EasingSelect value={next.interp} options={INTERP_OPTIONS} showLabels onChange={posingActions.setNextInterp} />
      </div>

      {posed ? (
        <div className="flex items-center gap-2 text-[11px] text-amber-300">
          <span className="min-w-0 flex-1">Moved — not keyed yet. Moving the time slider drops it.</span>
          <Button
            size="xs"
            icon={<IconArrowBackUp />}
            tooltip="Put it back where the keys have it"
            shortcut="animation.pose.discard"
            onClick={() => void posingActions.discardPose()}
          >
            Discard
          </Button>
        </div>
      ) : (
        <span className="text-[11px] text-slate-500">
          {next.replaces
            ? 'A key is at this time — Key replaces it with the pose above.'
            : 'Drag the gizmo (Move / Rotate in the Timeline) or type the values, then Key.'}
        </span>
      )}
      <KeyFromHere objects={[object.id]} />
    </InspectorFrame>
  );
}
