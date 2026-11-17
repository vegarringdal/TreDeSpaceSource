import { Checkbox, NumberInput } from '@treDeSpaceUI/widgets';
import {
  NWD_ERROR_MAX,
  NWD_ERROR_MIN,
  NWD_ERROR_STEP,
  NWD_KEEP_MAX,
  NWD_KEEP_MIN,
  NWD_KEEP_STEP,
} from '../../../lib/nwd2tdp/nwdSimplify';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';

type NwdSimplifyRowsProps = Readonly<{
  /** Width of the left-hand labels, shared with the other option rows. */
  labelWidth: number;
}>;

/** The Navisworks section's mesh simplification options: on / off, and — when
 *  on — how much may go and how far the surface may move. */
export function NwdSimplifyRows({ labelWidth }: NwdSimplifyRowsProps) {
  const { nwd } = assetsState.use();

  return (
    <>
      <Checkbox
        label="Simplify"
        shortcut="assets.nwd.simplify"
        tooltip="Remove triangles the shape does not need, after the cleanup — smaller files, faster drawing. Off: every triangle of the file is kept"
        checked={nwd.simplify}
        onChange={(v) => act.setNwdOptions({ simplify: v })}
      />
      {nwd.simplify && (
        <>
          <NumberInput
            label="Keep"
            labelPosition="left"
            labelWidth={labelWidth}
            tooltip="The lowest share of a part's triangles that may be left: 75 % removes at most a quarter. The simplifier stops earlier when going on would exceed Max error"
            value={nwd.simplifyKeep}
            min={NWD_KEEP_MIN}
            max={NWD_KEEP_MAX}
            step={NWD_KEEP_STEP}
            unit="%"
            decShortcut="assets.nwd.simplifyKeep.dec"
            incShortcut="assets.nwd.simplifyKeep.inc"
            onChange={(v) => act.setNwdOptions({ simplifyKeep: v })}
          />
          <NumberInput
            label="Max error"
            labelPosition="left"
            labelWidth={labelWidth}
            tooltip="How far the simplified surface may move, as a percentage of each part's size. 0 (default) only removes triangles that change nothing, which is little; raise it (try 0.1) to remove more — too high and round parts turn angular"
            value={nwd.simplifyError}
            min={NWD_ERROR_MIN}
            max={NWD_ERROR_MAX}
            step={NWD_ERROR_STEP}
            unit="%"
            decShortcut="assets.nwd.simplifyError.dec"
            incShortcut="assets.nwd.simplifyError.inc"
            onChange={(v) => act.setNwdOptions({ simplifyError: v })}
          />
        </>
      )}
    </>
  );
}
