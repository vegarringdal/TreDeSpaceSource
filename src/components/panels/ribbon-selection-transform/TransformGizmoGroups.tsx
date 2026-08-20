import { IconCrosshair, IconFocusCentered, IconLock, IconRestore, IconX } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { selectionState } from '../../../state/viewer/selection.state';
import { ribbonSelectionTransformActions as act } from './ribbonSelectionTransform.actions';
import { ribbonSelectionTransformState } from './ribbonSelectionTransform.state';

const GIZMO_MODES = ['move', 'rotate', 'scale'] as const;

/** Gizmo mode selection and custom-pivot placement for the transform ribbon. */
export function TransformGizmoGroups() {
  const s = ribbonSelectionTransformState.use();
  const none = selectionState.use().count === 0;

  return (
    <>
      <RibbonSection title="Gizmo">
        {GIZMO_MODES.map((m) => (
          <RibbonButton
            key={m}
            size="mini"
            label={m[0].toUpperCase() + m.slice(1)}
            selected={s.gizmoMode === m}
            disabled={none}
            tooltip={`Show the ${m} gizmo on the selection in the viewport`}
            shortcut={`transform.gizmo.${m}`}
            onClick={() => act.setGizmoMode(m)}
          />
        ))}
      </RibbonSection>

      <RibbonSection title="Pivot">
        {s.pivotSetting ? (
          <>
            <RibbonButton
              size="mini"
              icon={<IconLock />}
              label="Lock"
              tooltip="Confirm this pivot position — rotate and scale turn around it"
              onClick={act.lockPivot}
            />
            <RibbonButton
              size="mini"
              icon={<IconX />}
              label="Cancel"
              tooltip="Discard the custom pivot and go back to the selection center"
              onClick={act.cancelPivot}
            />
            <RibbonButton
              size="mini"
              icon={<IconFocusCentered />}
              label="Item Pivot"
              selected={s.pivotFromItem}
              tooltip="While on, click an item in the 3D view to move the pivot to its center instead of dragging the arrows"
              shortcut="transform.pivot.item"
              onClick={act.togglePivotFromItem}
            />
          </>
        ) : (
          <>
            <RibbonButton
              size="medium"
              icon={<IconCrosshair />}
              label={s.pivot ? 'Adjust' : 'Set Pivot'}
              disabled={none}
              tooltip={
                s.pivot
                  ? `Custom pivot at (${s.pivot.map((v) => v.toFixed(2)).join(', ')}) — drag the arrows to adjust`
                  : 'Place a custom pivot — rotate and scale turn around it instead of the selection center'
              }
              shortcut="transform.pivot.set"
              onClick={act.startSetPivot}
            />
            <RibbonButton
              size="medium"
              icon={<IconRestore />}
              label="Reset"
              disabled={!s.pivot}
              tooltip="Back to the selection-center pivot"
              shortcut="transform.pivot.reset"
              onClick={act.resetPivot}
            />
          </>
        )}
      </RibbonSection>
    </>
  );
}
