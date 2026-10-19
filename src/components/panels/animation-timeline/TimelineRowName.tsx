import { cn } from '@treDeSpaceUI/lib/cn';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { RowId } from '../../../state/animation/rows';
import { timelineEditActions } from './timelineEdit.actions';

/** What clicking a row's name does, row by row. */
function rowTooltip(row: RowId | null): string {
  if (row === null) {
    return 'Edit this overlay';
  }
  if (row.startsWith('o:')) {
    return 'Make this the current row — Key keys it. Ctrl adds or drops this object, Shift picks every object up to it: drag the gizmo to pose them all';
  }
  switch (row) {
    case '@scene':
      return "The scene's settings in the Key panel — name, end, loop, step card";
    case '@objects':
      return 'The object tools in the Key panel: + Object, one per child or per node, select them all';
    case '@callouts':
      return 'Add an overlay from the Key panel — a callout, title, caption or card';
    case '@steps':
      return 'Make this the current row — Key adds a step at the time slider';
    default:
      return 'Make this the current row — Key keys it at the time slider';
  }
}

/** A row's name: click makes the row current (Key keys it). */
export function TimelineRowName({
  name,
  row,
  current,
  selected,
  muted,
  onPick,
}: {
  name: string;
  row: RowId | null;
  current: boolean;
  /** an object whose items are selected (one of several) */
  selected?: boolean;
  muted?: boolean;
  onPick?: () => void;
}) {
  const handleClick = (e: ReactMouseEvent) => {
    if (row) {
      timelineEditActions.pickRow(row, { additive: e.ctrlKey || e.metaKey, range: e.shiftKey });
    }
    onPick?.();
  };

  return (
    <button
      type="button"
      className={cn(
        'w-full cursor-pointer truncate text-left hover:text-sky-200',
        current && 'font-semibold text-sky-300',
        selected && !current && 'text-sky-300',
        muted && 'line-through opacity-60',
      )}
      data-tooltip={rowTooltip(row)}
      onClick={handleClick}
    >
      {name}
    </button>
  );
}
