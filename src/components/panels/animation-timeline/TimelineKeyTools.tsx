import {
  IconArrowsMove,
  IconChevronLeft,
  IconChevronRight,
  IconCrosshair,
  IconKey,
  IconKeyOff,
  IconPlayerRecordFilled,
  IconPlus,
  IconRotate,
} from '@tabler/icons-react';
import { Button, Menu, SplitButton } from '@treDeSpaceUI/widgets';
import type { PivotAnchor } from '../../../lib/animation/types';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { keysActions } from '../../../state/animation/keys.actions';
import { objectsActions } from '../../../state/animation/objects.actions';
import { posingActions } from '../../../state/animation/posing.actions';
import { rowObject } from '../../../state/animation/rows';
import { ribbonSelectionTransformState } from '../ribbon-selection-transform/ribbonSelectionTransform.state';
import { useMenuAnchor } from '../shared/useMenuAnchor';
import { objectsMenuItems } from './objectsMenu';

/** The sides Pivot ▾ offers (as the view cube names them). */
const PIVOT_SIDES: readonly { value: PivotAnchor; label: string }[] = [
  { value: 'center', label: 'Centre of its items' },
  { value: 'bottom', label: 'Bottom centre' },
  { value: 'top', label: 'Top centre' },
  { value: 'front', label: 'Front centre (−Y)' },
  { value: 'back', label: 'Back centre (+Y)' },
  { value: 'left', label: 'Left centre (−X)' },
  { value: 'right', label: 'Right centre (+X)' },
];

/** + Object · Move Rotate Pivot ▾ · Key · Delete key · ◀ key key ▶ · Auto-key. */
export function TimelineKeyTools() {
  const ui = animationUiState.use();
  const gizmo = ribbonSelectionTransformState.useSelect((s) => s.gizmoMode);
  const pivot = useMenuAnchor('animation.menu.objectPivot');
  const object = rowObject(ui.current);
  const canDelete = ui.picked.kind === 'keys' && ui.picked.indices.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <SplitButton
        size="sm"
        icon={<IconPlus />}
        label="Object"
        tooltip="The selection as an object, with a key at the time slider holding where it stands"
        shortcut="animation.object.add"
        menuTooltip="Many objects at once: one per child or per selected node; select them all"
        onClick={() => void objectsActions.fromSelection({ key: true })}
        menu={objectsMenuItems()}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconArrowsMove />}
        active={gizmo === 'move'}
        tooltip="Move gizmo on the current object — drag to pose, then Key"
        shortcut="animation.gizmo.move"
        onClick={() => void posingActions.gizmo('move')}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconRotate />}
        active={gizmo === 'rotate'}
        tooltip="Rotate gizmo on the current object — drag to pose, then Key"
        shortcut="animation.gizmo.rotate"
        onClick={() => void posingActions.gizmo('rotate')}
      />
      <span ref={pivot.wrap} className="inline-flex">
        <Button
          iconOnly
          size="sm"
          icon={<IconCrosshair />}
          disabled={!object}
          tooltip="What the current object turns about (keys without a pivot of their own)"
          shortcut="animation.menu.objectPivot"
          onClick={pivot.open}
        />
      </span>
      <Button
        size="sm"
        icon={<IconKey />}
        tooltip="Key the current row at the time slider: the pose, the view, the clipping, the colour rules, the labels or measurements, or a new step (I)"
        shortcut="animation.addKey"
        onClick={() => void posingActions.key()}
      >
        Key
      </Button>
      <Button
        iconOnly
        size="sm"
        icon={<IconKeyOff />}
        disabled={!canDelete}
        tooltip="Delete the picked keys (Delete)"
        shortcut="animation.deleteKey"
        onClick={() => keysActions.deletePicked()}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconChevronLeft />}
        tooltip="Time slider to the previous key of the current row"
        shortcut="animation.prevKey"
        onClick={() => keysActions.stepKey(-1)}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconChevronRight />}
        tooltip="Time slider to the next key of the current row"
        shortcut="animation.nextKey"
        onClick={() => keysActions.stepKey(1)}
      />
      <Button
        iconOnly
        size="sm"
        active={ui.autoKey}
        icon={<IconPlayerRecordFilled className={ui.autoKey ? 'text-red-500' : 'text-slate-500'} />}
        tooltip="Auto-key: every gizmo drag keys at the time slider straight away (red frame)"
        shortcut="animation.toggleAutoKey"
        onClick={animationUiActions.toggleAutoKey}
      />
      <Menu
        anchor={pivot.anchor}
        onClose={pivot.close}
        items={[
          ...PIVOT_SIDES.map((side) => ({
            id: side.value,
            label: side.label,
            shortcut: `animation.object.pivot.${side.value}`,
            onSelect: () => object && objectsActions.setPivot(object, side.value),
          })),
          { separator: true },
          {
            id: 'gizmo',
            label: "The gizmo's pivot (a point of the object)",
            shortcut: 'animation.object.pivotFromGizmo',
            onSelect: () => object && objectsActions.pivotFromGizmo(object),
          },
        ]}
      />
    </div>
  );
}
