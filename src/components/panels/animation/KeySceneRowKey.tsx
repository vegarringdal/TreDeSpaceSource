import { IconTrash } from '@tabler/icons-react';
import { Button, SegmentedControl, TimeInput } from '@treDeSpaceUI/widgets';
import type { Interp } from '../../../lib/animation/types';
import { keysActions } from '../../../state/animation/keys.actions';
import type { KeyRow } from '../../../state/animation/rows';

const LABEL_W = 56;

/** How a camera / section key arrives, in that row's words. */
export interface ArriveOption {
  value: Interp;
  label: string;
  tooltip: string;
  shortcut: string;
}

/** The fields every camera / section key has: time, how it arrives, delete. */
export function KeySceneRowKey({
  row,
  index,
  indices,
  t,
  interp,
  arrive,
}: {
  row: KeyRow;
  index: number;
  indices: number[];
  t: number;
  interp: Interp;
  arrive: readonly ArriveOption[];
}) {
  return (
    <>
      <div className="flex items-center gap-1">
        <TimeInput
          className="min-w-0 flex-1"
          label="Time"
          tooltip="This key's time (s)"
          labelPosition="left"
          labelWidth={LABEL_W}
          value={t}
          onChange={(v) => keysActions.setTime(row, index, v)}
        />
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          icon={<IconTrash />}
          tooltip={indices.length > 1 ? `Delete the ${indices.length} picked keys` : 'Delete this key'}
          shortcut="animation.deleteKey"
          onClick={() => keysActions.deleteKeys(row, indices)}
        />
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="shrink-0 text-slate-400" style={{ width: LABEL_W }}>
          Arrives
        </span>
        <SegmentedControl
          size="sm"
          grow
          value={interp}
          options={arrive}
          onChange={(v) => keysActions.setInterp(row, indices, v)}
        />
      </div>
    </>
  );
}
