import { NumberInput } from '@treDeSpaceUI/widgets';
import { MAX_OFFSET_STEP, offsetStepIncrement } from '../../../state/scans/offsetStep';
import { scansActions } from '../../../state/scans/scans.actions';
import { scansState } from '../../../state/scans/scans.state';

const LABEL_WIDTH = 70;

/**
 * How far one − / + of every scan's offset boxes moves it. One value for all
 * scans, above the list. Type any step, or press − / + to walk through the
 * sizes: the box has no lower bound of its own, so a − at a power of ten
 * reaches the action as 0 and continues in the decade below (0.1 → 0.09).
 */
export function ScanOffsetStepRow() {
  const { offsetStep } = scansState.use();

  return (
    <NumberInput
      className="min-w-0 flex-1"
      label="Offset step"
      labelPosition="left"
      labelWidth={LABEL_WIDTH}
      value={offsetStep}
      max={MAX_OFFSET_STEP}
      step={offsetStepIncrement(offsetStep)}
      precision={3}
      unit="m"
      onChange={scansActions.setOffsetStep}
      tooltip="How far one − / + of the X, Y and Z offset boxes below moves a scan, metres. Type a value (0.001 to 1000), or step it: 0.1 → 0.2 … 1 → 2 going up, 0.1 → 0.09 … 0.01 going down"
      decShortcut="scans.offsetStep.dec"
      incShortcut="scans.offsetStep.inc"
    />
  );
}
