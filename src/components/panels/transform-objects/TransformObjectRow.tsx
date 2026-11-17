import { cn } from '@treDeSpaceUI/lib/cn';
import { Collapsible } from '@treDeSpaceUI/widgets';
import { useEffect, useRef } from 'react';
import { poseSummary } from '../../../lib/transform/summary';
import type { TransformObject } from '../../../lib/transform/types';
import { transformState } from '../../../state/transform/transform.state';
import { useTransformResting } from '../../../state/transform/useTransformResting';
import { TransformObjectFields } from './TransformObjectFields';
import { TransformObjectRowButtons } from './TransformObjectRowButtons';
import { transformObjectsUiActions as ui } from './transformObjectsUi.actions';
import { transformObjectsUiState } from './transformObjectsUi.state';

/** Each level of "rides on" steps a row in by this much. */
const INDENT_PX = 14;

/** One object's row: its name and how far it stands from the model in the
 *  header, its numbers inside. Indented under what it rides on; the current
 *  object's row is highlighted, opens by itself and scrolls into view.
 *  While animating the row can be read but not edited. */
export function TransformObjectRow({
  object,
  depth,
  hasSubObjects,
}: {
  object: TransformObject;
  depth: number;
  hasSubObjects: boolean;
}) {
  const isCurrent = transformState.useSelect((s) => s.currentId === object.id);
  const isOpen = transformObjectsUiState.useSelect((s) => s.open[object.id] === true);
  const rowRef = useRef<HTMLDivElement>(null);
  const isResting = useTransformResting();

  useEffect(() => {
    if (isCurrent) {
      ui.setOpen(object.id, true);
      rowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [isCurrent, object.id]);

  return (
    <div ref={rowRef} style={{ marginLeft: depth * INDENT_PX }}>
      <Collapsible
        open={isOpen}
        onToggle={(open) => ui.setOpen(object.id, open)}
        className={cn(isCurrent && 'border-sky-500')}
        title={
          <span className={cn('min-w-0 truncate', object.muted && 'text-slate-500 line-through')}>{object.name}</span>
        }
        aside={<span className="font-mono text-amber-300">{object.muted ? 'muted' : poseSummary(object)}</span>}
        actions={
          <TransformObjectRowButtons
            object={object}
            isCurrent={isCurrent}
            hasSubObjects={hasSubObjects}
            isResting={isResting}
          />
        }
      >
        <TransformObjectFields object={object} />
      </Collapsible>
    </div>
  );
}
