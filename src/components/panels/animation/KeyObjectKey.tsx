import { IconTrash } from '@tabler/icons-react';
import { Button, EasingSelect, RotationInput, TimeInput, Vec3Input } from '@treDeSpaceUI/widgets';
import { INTERP_OPTIONS } from '../../../lib/animation/interpOptions';
import { SAME_KEY_S } from '../../../lib/animation/keyRows';
import type { AnimObject, ObjectKey } from '../../../lib/animation/types';
import { keysActions } from '../../../state/animation/keys.actions';
import { playerState } from '../../../state/animation/player.state';
import { objectRow } from '../../../state/animation/rows';
import { InspectorFrame } from './InspectorFrame';
import { KeyInstantFields } from './KeyInstantFields';
import { KeyPivotFields } from './KeyPivotFields';
import { KeySpinFields } from './KeySpinFields';

const LABEL_W = 56;

/** A picked object key: time, where it is (move / rotate), how it arrives,
 *  spin and its instant values. Dragging the gizmo at the key edits it too
 *  (then Key). */
export function KeyObjectKey({ object, index, indices }: { object: AnimObject; index: number; indices: number[] }) {
  const key = object.keys[index];
  // Key re-poses this key only while the time slider is on it
  const atKey = playerState.useSelect((s) => key !== undefined && Math.abs(s.time - key.t) <= SAME_KEY_S);
  if (!key) {
    return null;
  }
  const row = objectRow(object.id);
  const patch = (p: Partial<ObjectKey>, field: string) =>
    keysActions.updateObjectKey(object.id, index, p, `key-${field}:${object.id}:${index}`);

  const actions = (
    <Button
      iconOnly
      size="sm"
      variant="ghost"
      icon={<IconTrash />}
      tooltip={indices.length > 1 ? `Delete the ${indices.length} picked keys` : 'Delete this key'}
      shortcut="animation.deleteKey"
      onClick={() => keysActions.deleteKeys(row, indices)}
    />
  );

  return (
    <InspectorFrame
      kind="Key"
      name={`${object.name || 'Object'} · ${key.t.toFixed(2)} s${indices.length > 1 ? ` (+${indices.length - 1})` : ''}`}
      actions={actions}
    >
      <TimeInput
        label="Time"
        tooltip="This key's time (s) — the time slider moves with it"
        labelPosition="left"
        labelWidth={LABEL_W}
        value={key.t}
        onChange={(t) => keysActions.setTime(row, index, t)}
      />
      <Vec3Input
        label="Move"
        labelWidth={LABEL_W}
        value={key.move}
        step={0.05}
        unit="m"
        tooltips={['X from its place (m)', 'Y from its place (m)', 'Z from its place (m)']}
        onChange={(move) => patch({ move }, 'move')}
      />
      <RotationInput
        label="Rotate"
        labelWidth={LABEL_W}
        value={key.rotate}
        onChange={(rotate) => patch({ rotate }, 'rotate')}
      />
      <KeyPivotFields object={object} index={index} />
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>Arrives</span>
        <EasingSelect
          value={key.interp}
          options={INTERP_OPTIONS}
          showLabels
          onChange={(interp) => keysActions.setInterp(row, indices, interp)}
        />
      </div>
      <KeySpinFields spin={key.spin} onChange={(spin) => patch({ spin }, 'spin')} />
      <KeyInstantFields value={key} onChange={(p) => patch(p, 'instant')} />
      <span className="text-[11px] text-slate-500">
        Move and Rotate are measured from where the object stands in the model, about the pivot.{' '}
        {atKey
          ? 'Drag the gizmo here and press Key to re-pose this key.'
          : 'The time slider is elsewhere: Key makes a new key there — click this key to come back to it.'}
      </span>
    </InspectorFrame>
  );
}
