import { IconTargetArrow } from '@tabler/icons-react';
import { RibbonButton, RibbonNumber, RibbonSection, RibbonSlot } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { ribbonSelectionTransformActions as act } from './ribbonSelectionTransform.actions';
import { ribbonSelectionTransformState } from './ribbonSelectionTransform.state';

const UNITS = ['mm', 'cm', 'm'] as const;

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
          <div className="grid h-full grid-cols-3 gap-[2px]">
            {UNITS.map((u) => (
              <button
                key={u}
                type="button"
                data-tooltip={`Step unit: ${u === 'm' ? 'meters' : u === 'cm' ? 'centimeters' : 'millimeters'}`}
                className={`flex cursor-pointer items-center justify-center border text-xs leading-none transition-colors ${
                  s.unit === u
                    ? 'border-blue-400 bg-blue-950 text-blue-100 hover:border-blue-300'
                    : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100'
                }`}
                onClick={() => act.setUnit(u)}
              >
                {u}
              </button>
            ))}
          </div>
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
