import { IconTargetArrow } from '@tabler/icons-react';
import { RibbonButton, RibbonNumber, RibbonSection, RibbonSlot, SegmentedControl } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { ribbonSelectionTransformActions as act } from './ribbonSelectionTransform.actions';
import { ribbonSelectionTransformState } from './ribbonSelectionTransform.state';

const UNIT_OPTIONS = [
  { value: 'mm', label: 'mm', tooltip: 'Step unit: millimeters' },
  { value: 'cm', label: 'cm', tooltip: 'Step unit: centimeters' },
  { value: 'm', label: 'm', tooltip: 'Step unit: meters' },
] as const;

/** Move-to-click arming and the step size/unit controls for the transform
 *  ribbon. */
export function TransformStepGroups() {
  const s = ribbonSelectionTransformState.use();
  const none = selectionState.use().count === 0;

  return (
    <>
      <RibbonSection title="Quick Move">
        <RibbonButton
          size="big"
          icon={<IconTargetArrow />}
          label="Move to Click"
          selected={s.moveToClickArmed}
          disabled={none && !s.moveToClickArmed}
          tooltip="Arm, then click a point in the 3D view — the selection moves there with its bottom aligned to the clicked point (undoable)"
          shortcut="transform.moveToClick"
          onClick={act.toggleMoveToClick}
        />
      </RibbonSection>

      <RibbonSection title="Step">
        {/* two-row layout: the unit toggles side by side, the step input under them */}
        <RibbonSlot size="medium">
          <SegmentedControl grow fill className="h-full" value={s.unit} options={UNIT_OPTIONS} onChange={act.setUnit} />
        </RibbonSlot>
        <RibbonNumber
          size="medium"
          unit={s.unit}
          min={0.01}
          step={0.25}
          precision={2}
          value={s.step}
          onChange={act.setStep}
          decShortcut="transform.step.dec"
          incShortcut="transform.step.inc"
        />
      </RibbonSection>
    </>
  );
}
