import { IconPlus, IconSelectAll } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import type { Scene } from '../../../lib/animation/types';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { objectsActions } from '../../../state/animation/objects.actions';
import { InspectorFrame } from './InspectorFrame';

/** The Objects row picked: make objects from the selection — one, one per
 *  child of each selected node, or one per selected node — and select them
 *  all to pose them together. */
export function KeyObjectsRow({ scene }: { scene: Scene }) {
  const selected = animationUiState.useSelect((s) => s.objectSelection.length);
  const n = scene.objects.length;

  const handleSelectAll = () => void objectsActions.selectObjects(scene.objects.map((o) => o.id));

  return (
    <InspectorFrame
      kind="Objects"
      name={`${n} object${n === 1 ? '' : 's'}${selected > 1 ? ` · ${selected} selected` : ''}`}
    >
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          icon={<IconPlus />}
          tooltip="The selection as one object, with a key at the time slider holding where it stands"
          shortcut="animation.object.add"
          onClick={() => void objectsActions.fromSelection({ key: true })}
        >
          Object
        </Button>
        <Button
          size="sm"
          icon={<IconPlus />}
          tooltip="Each child of every selected node becomes an object (a group becomes its parts), keyed at the time slider"
          shortcut="animation.objects.children"
          onClick={() => void objectsActions.fromSelectionParts('children')}
        >
          One per child
        </Button>
        <Button
          size="sm"
          icon={<IconPlus />}
          tooltip="Each selected node becomes an object of its own, keyed at the time slider"
          shortcut="animation.objects.nodes"
          onClick={() => void objectsActions.fromSelectionParts('nodes')}
        >
          One per node
        </Button>
        <Button
          size="sm"
          icon={<IconSelectAll />}
          disabled={n === 0}
          tooltip="Every object's items selected: one gizmo drag poses them all, Key keys each"
          shortcut="animation.objects.selectAll"
          onClick={handleSelectAll}
        >
          Select all
        </Button>
      </div>
      <span className="text-[11px] text-slate-400">
        Select a group, then One per child: each of its parts gets its own row, ready to key. On the rows, Ctrl adds or
        drops an object and Shift picks every object up to the one clicked — a gizmo drag then poses them all, and Key
        keys each.
      </span>
    </InspectorFrame>
  );
}
