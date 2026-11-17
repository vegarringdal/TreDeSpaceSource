import { Collapsible, EmptyState } from '@treDeSpaceUI/widgets';
import { useMemo } from 'react';
import { treeOrder } from '../../../lib/transform/pose';
import { transformState } from '../../../state/transform/transform.state';
import { TransformObjectRow } from './TransformObjectRow';

/** Height floor of the list: below it the PANEL scrolls instead of the list. */
const LIST_MIN_H = 'min-h-40';

/** The objects as a tree: each parent right above what rides on it. Fills
 *  the rest of the panel and scrolls on its own, so the section above stays
 *  in view. */
export function TransformObjectsListSection() {
  const objects = transformState.useSelect((s) => s.objects);
  const rows = useMemo(() => treeOrder(objects), [objects]);

  return (
    <Collapsible
      title="Transform objects"
      aside={objects.length}
      fill
      fillMinClass={LIST_MIN_H}
      bodyClassName="p-0"
      info={
        <>
          One row per object, indented under the object it rides on — moving a container carries its sub-objects. The
          header shows how far the object stands from where the model has it. Open a row to type the numbers, pick the
          pivot, change what it rides on, or add / take out items. The highlighted row is the <b>current object</b>: the
          one the selection is, and what the ribbon and the gizmo move.
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {rows.length === 0 && (
          <EmptyState layout="center">No transform objects yet — select items and press New Object.</EmptyState>
        )}
        {rows.map(({ object, depth }, i) => (
          <TransformObjectRow
            key={object.id}
            object={object}
            depth={depth}
            hasSubObjects={(rows[i + 1]?.depth ?? 0) > depth}
          />
        ))}
      </div>
    </Collapsible>
  );
}
