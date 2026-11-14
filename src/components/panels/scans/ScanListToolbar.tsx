import { IconChevronsDown, IconChevronsUp } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { scansActions } from '../../../state/scans/scans.actions';
import { ScanOffsetStepRow } from './ScanOffsetStepRow';

/** Above the scan list: the step every scan's offset boxes move by, and — on
 *  the right — open / fold every scan file at once. */
export function ScanListToolbar() {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ScanOffsetStepRow />
      <Button
        iconOnly
        icon={<IconChevronsDown />}
        onClick={scansActions.expandAllScans}
        shortcut="scans.files.expand"
        tooltip="Open every scan file"
      />
      <Button
        iconOnly
        icon={<IconChevronsUp />}
        onClick={scansActions.foldAllScans}
        shortcut="scans.files.fold"
        tooltip="Fold every scan file away (only the headers stay)"
      />
    </div>
  );
}
