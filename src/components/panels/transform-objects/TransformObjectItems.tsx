import { IconFoldDown, IconFoldUp, IconMinus, IconMovie, IconPlus } from '@tabler/icons-react';
import { Button, Checkbox } from '@treDeSpaceUI/widgets';
import type { TransformObject } from '../../../lib/transform/types';
import { transformActions as act } from '../../../state/transform/transform.actions';
import { transformState } from '../../../state/transform/transform.state';
import { useTransformResting } from '../../../state/transform/useTransformResting';
import { selectionState } from '../../../state/viewer/selection.state';
import { transformObjectsUiActions as ui } from './transformObjectsUi.actions';
import { transformObjectsUiState } from './transformObjectsUi.state';

const ICON = 14;

/** What an object holds, and the fix for a first selection that was not
 *  quite right: add the selected items to it, or take them out (the hotkeys
 *  act on the object that was current last, so only its row shows them). A
 *  container also gets Collapse all / Expand all for its sub-objects' rows,
 *  on the right — the pair of the panel's top section, for this object. To
 *  animation copies the object (and, when ticked, its sub-objects) into the
 *  animation's active scene. */
export function TransformObjectItems({ object }: { object: TransformObject }) {
  const info = transformState.useSelect((s) => s.info[object.id]);
  const isCurrent = transformState.useSelect((s) => s.currentId === object.id);
  const isLast = transformState.useSelect((s) => s.lastCurrentId === object.id);
  const hasSelection = selectionState.useSelect((s) => s.count > 0);
  // with the object itself selected there is nothing to add or take out
  // …and while animating the objects rest
  const isResting = useTransformResting();
  const canEdit = hasSelection && !isCurrent && !isResting;
  const leftOut = object.exclude?.length ?? 0;
  const withSubObjects = transformObjectsUiState.useSelect((s) => s.withSubObjects);
  const hasSubObjects = transformState.useSelect((s) => s.objects.some((o) => o.parent === object.id));

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Button
        icon={<IconPlus size={ICON} />}
        disabled={!canEdit}
        onClick={() => void act.editItems(object.id, 'add')}
        tooltip="Add the selected items to this object. Select what is missing first (not the object itself)."
        shortcut={isLast ? 'transform.object.addSelection' : undefined}
      >
        Add selection
      </Button>
      <Button
        icon={<IconMinus size={ICON} />}
        disabled={!canEdit}
        onClick={() => void act.editItems(object.id, 'remove')}
        tooltip="Take the selected items out of this object. Select what should not be in it first."
        shortcut={isLast ? 'transform.object.removeSelection' : undefined}
      >
        Remove selection
      </Button>
      <Button
        icon={<IconMovie size={ICON} />}
        onClick={() => ui.toAnimation(object.id)}
        tooltip="Add this object to the animation's active scene: the same items, pivot and place in the tree, with a first key at 0 s holding its move and rotation — so the animation starts from what is set up here. A copy: later changes here do not follow. Scale is not taken (animation does not scale)."
        shortcut={isCurrent ? 'transform.object.toAnimation' : undefined}
      >
        To animation
      </Button>
      {hasSubObjects && (
        <Checkbox
          label="with sub-objects"
          checked={withSubObjects}
          onChange={ui.setWithSubObjects}
          tooltip="On: everything riding on this object goes to the animation too, each as a sub-object with its own first key. Off: this object goes alone and what rides on it is left out of it."
          shortcut="transform.toAnimation.subObjects"
        />
      )}
      <span className="text-[11px] text-slate-500">
        {info ? `${info.items.toLocaleString()} item(s)` : 'Resolving items…'}
        {` · ${object.items.length} node(s)`}
        {leftOut > 0 ? `, ${leftOut} left out` : ''}
        {info && info.missing > 0 ? ` · ${info.missing} name(s) not in the loaded models` : ''}
      </span>
      {hasSubObjects && (
        <span className="ml-auto flex items-center gap-2">
          <Button
            iconOnly
            icon={<IconFoldUp size={ICON} />}
            onClick={() => ui.setSubObjectsOpen(object.id, false)}
            tooltip="Collapse all sub-objects: close the row of every object riding on this one"
            shortcut={isCurrent ? 'transform.object.children.collapse' : undefined}
          />
          <Button
            iconOnly
            icon={<IconFoldDown size={ICON} />}
            onClick={() => ui.setSubObjectsOpen(object.id, true)}
            tooltip="Expand all sub-objects: open the row of every object riding on this one"
            shortcut={isCurrent ? 'transform.object.children.expand' : undefined}
          />
        </span>
      )}
    </div>
  );
}
