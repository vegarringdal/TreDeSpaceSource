import {
  IconArrowsExchange,
  IconCrosshair,
  IconFocusCentered,
  IconLock,
  IconRestore,
  IconX,
} from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { playerState } from '../../../state/animation/player.state';
import { transformState } from '../../../state/transform/transform.state';
import { selectionState } from '../../../state/viewer/selection.state';
import { ribbonSelectionTransformActions as act } from './ribbonSelectionTransform.actions';
import { ribbonSelectionTransformState } from './ribbonSelectionTransform.state';

const GIZMO_MODES = ['move', 'rotate', 'scale'] as const;

/** Gizmo mode selection and custom-pivot placement for the transform ribbon. */
export function TransformGizmoGroups() {
  const s = ribbonSelectionTransformState.use();
  const none = selectionState.useSelect((sel) => sel.count === 0);
  const hasObject = transformState.useSelect((t) => t.currentId !== null);
  const isAnimating = playerState.useSelect((p) => p.status !== 'off');
  // a gizmo drag needs something to move: the current object, or (while
  // animating) the object the drag poses
  const noTarget = none || !(hasObject || isAnimating);
  // outside animation the pivot is the current object's own: "placed by
  // hand" is its Pivot offset in the Transform Objects list
  const isObjectPivotPlaced = transformState.useSelect(
    (t) => t.objects.find((o) => o.id === t.currentId)?.pivot.offset !== undefined,
  );
  const hasPivot = isAnimating ? s.pivot !== null : isObjectPivotPlaced;

  return (
    <>
      <RibbonSection title="On/Off">
        {GIZMO_MODES.map((m) => (
          <RibbonButton
            key={m}
            size="mini"
            label={m[0].toUpperCase() + m.slice(1)}
            selected={s.gizmoMode === m}
            disabled={noTarget}
            tooltip={`Show the ${m} gizmo on the current object in the viewport (make the selection an object first: New Object)`}
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
              tooltip="Keep this pivot position — it becomes the object's pivot: rotate and scale turn around it"
              shortcut="transform.pivot.lock"
              onClick={act.lockPivot}
            />
            <RibbonButton
              size="mini"
              icon={<IconX />}
              label="Cancel"
              tooltip="Discard this placement — the pivot stays where it was"
              shortcut="transform.pivot.cancel"
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
              label={hasPivot ? 'Adjust' : 'Set Pivot'}
              disabled={noTarget}
              tooltip={
                hasPivot
                  ? "The object's pivot was placed by hand (its Pivot offset in the Transform Objects list) — drag the arrows to adjust it"
                  : "Place the object's pivot by hand: drag the arrows, then Lock. Rotate and scale turn around it, the gizmo sits on it, and the Transform Objects list shows it as the Pivot offset."
              }
              shortcut="transform.pivot.set"
              onClick={act.startSetPivot}
            />
            <RibbonButton
              size="medium"
              icon={<IconRestore />}
              label="Reset"
              disabled={!hasPivot}
              tooltip="Drop the hand-placed pivot: back on the side picked under Pivot in the Transform Objects list (the centre by default)"
              shortcut="transform.pivot.reset"
              onClick={act.resetPivot}
            />
          </>
        )}
      </RibbonSection>

      <RibbonSection title="Options">
        <RibbonButton
          icon={<IconArrowsExchange />}
          label="Auto Disable"
          selected={s.offOnRibbonSwitch}
          tooltip="Automatically disarm the gizmo, pivot placement and move-to-click when you leave this ribbon: switching to another ribbon tab, or changing layout via the App Layout ribbon or the F-keys. Keeps a mode that reacts to viewport clicks from staying armed while you work elsewhere. A locked pivot is kept — it is a position, not a mode. Default on."
          shortcut="transform.offOnSwitch"
          onClick={() => act.toggleOffOnRibbonSwitch()}
        />
      </RibbonSection>
    </>
  );
}
