import { IconMinus, IconPlus, IconPointer, IconRefresh, IconSitemap, IconX } from '@tabler/icons-react';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import type { AnimObject } from '../../../lib/animation/types';
import { objectItemsActions } from '../../../state/animation/objectItems.actions';
import { objectsActions } from '../../../state/animation/objects.actions';
import { useItemSetInfo } from './useItemSetInfo';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Entries listed before "+ n more". */
const LIST_MAX = 8;

// -----------------------------------------------------------------------------
// component
// -----------------------------------------------------------------------------

/** What the object holds, like a Navisworks animation set — and better:
 *  nodes added (+) and nodes left out (−), the selection added or taken
 *  out, and the closest group when it says the same more simply. */
export function ObjectItemsFields({ object }: { object: AnimObject }) {
  const { count, group, names } = useItemSetInfo(object);
  const exclude = object.exclude ?? [];
  const rows = [
    ...object.items.map((name) => ({ name, list: 'items' as const })),
    ...exclude.map((name) => ({ name, list: 'exclude' as const })),
  ];

  return (
    <Collapsible title="Items" aside={count === null ? '…' : `${count} item${count === 1 ? '' : 's'}`} defaultOpen>
      <div className="flex flex-col gap-1 text-[11px]">
        {rows.slice(0, LIST_MAX).map((r) => (
          <div key={`${r.list}:${r.name}`} className="flex items-center gap-1">
            <span className={r.list === 'items' ? 'w-3 text-emerald-400' : 'w-3 text-rose-400'}>
              {r.list === 'items' ? '+' : '−'}
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-300" title={names[r.name] ?? r.name}>
              {names[r.name] ?? r.name}
            </span>
            <Button
              iconOnly
              size="xs"
              variant="ghost"
              icon={<IconX />}
              tooltip={r.list === 'items' ? 'Take this node out of the list' : 'Stop leaving this node out'}
              onClick={() => objectItemsActions.removeEntry(object.id, r.name, r.list)}
            />
          </div>
        ))}
        {rows.length > LIST_MAX && <span className="text-slate-500">+ {rows.length - LIST_MAX} more</span>}
        <div className="flex flex-wrap gap-1">
          <Button
            size="xs"
            icon={<IconPlus />}
            tooltip="The selected nodes join the object (a node it leaves out comes back)"
            shortcut="animation.object.addSelection"
            onClick={() => void objectItemsActions.addSelection(object.id)}
          >
            Add selection
          </Button>
          <Button
            size="xs"
            icon={<IconMinus />}
            tooltip="The selected nodes leave the object — a node inside a group is left out of it"
            shortcut="animation.object.removeSelection"
            onClick={() => void objectItemsActions.removeSelection(object.id)}
          >
            Remove selection
          </Button>
          <Button
            size="xs"
            icon={<IconPointer />}
            tooltip="Select its items in the 3D view and the Hierarchy"
            shortcut="animation.object.select"
            onClick={() => void objectsActions.selectItems(object.id)}
          >
            Select
          </Button>
          <Button
            size="xs"
            icon={<IconRefresh />}
            tooltip="Its items become the selection's — every key stays"
            shortcut="animation.object.update"
            onClick={() => void objectsActions.updateFromSelection(object.id)}
          >
            Update from selection
          </Button>
        </div>
        {group && (
          <div className="flex items-center gap-1 text-sky-300">
            <IconSitemap size={13} className="shrink-0" />
            <span className="min-w-0 flex-1">
              Closest group: <b>{group.name}</b>
              {group.minus.length > 0 && ` minus ${group.minus.length} node${group.minus.length === 1 ? '' : 's'}`} —
              the same items, simpler
            </span>
            <Button
              size="xs"
              tooltip="Name the items as the closest group minus the few nodes not in it — it then follows the group in the model"
              shortcut="animation.object.closestGroup"
              onClick={() => void objectItemsActions.applyClosestGroup(object.id)}
            >
              Use it
            </Button>
          </div>
        )}
      </div>
    </Collapsible>
  );
}
