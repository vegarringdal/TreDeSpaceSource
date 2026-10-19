import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { cn } from '../../lib/cn';
import { ChapterRow } from './ChapterRow';

export interface ChapterListRow {
  /** Stable identity (what the callbacks hand back). */
  id: string;
  /** Nesting level, 0 = top. */
  depth: number;
  /** The row's name (one line, truncated). */
  title: string;
  /** Dim line under the title (shown for the expanded row). */
  subtitle?: string;
  /** Right-aligned length / note, e.g. "4.0s". */
  duration?: string;
  /** done = muted with a check, current = accent edge, upcoming = plain. */
  status: 'done' | 'current' | 'upcoming';
  /** 0..1 progress bar under the current row (null/absent = none). */
  progress?: number | null;
  /** Warning badge (continuity problems). */
  warning?: boolean;
  /** Small dim note before the duration (e.g. "paused"). */
  note?: string;
  /** A chapter title shown above this row (the first row of a group). */
  heading?: string;
}

export interface ChapterListProps {
  /** The chapters in order. Each is numbered among the rows of its depth
   *  through the whole list (the count does not restart under a new parent). */
  rows: readonly ChapterListRow[];
  /** The row that shows its subtitle + detail. */
  expanded?: string | null;
  /** Per-row action buttons, shown on hover / focus (play, loop…). */
  renderActions?: (row: ChapterListRow) => ReactNode;
  /** Extra content under the expanded row. */
  renderDetail?: (row: ChapterListRow) => ReactNode;
  /** Click or Enter on a row. */
  onActivate: (id: string) => void;
  /** A row dropped onto another: move `id` before `beforeId`. Any row onto
   *  any row — keep moves within one parent yourself; nothing drops after the
   *  last row. Omit to disable dragging. */
  onReorder?: (id: string, to: { beforeId: string }) => void;
  /** Shown when there are no rows (default "Nothing here yet."). */
  emptyText?: ReactNode;
  className?: string;
}

/**
 * An ordered list of chapters — the parts of a sequence, the steps of a
 * walkthrough: number, title, length, a done / current / upcoming state with
 * an optional progress bar, and hover actions. Arrow keys move between rows,
 * Enter activates; drag-to-reorder when `onReorder` is given.
 */
export function ChapterList({
  rows,
  expanded = null,
  renderActions,
  renderDetail,
  onActivate,
  onReorder,
  emptyText = 'Nothing here yet.',
  className = '',
}: ChapterListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') {
      return;
    }
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-chapter]') ?? [])];
    const at = items.indexOf(document.activeElement instanceof HTMLElement ? document.activeElement : items[0]);
    const next = items[Math.min(items.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    next?.focus();
    e.preventDefault();
  };

  if (rows.length === 0) {
    return <div className={cn('px-2 py-3 text-slate-500 text-xs italic', className)}>{emptyText}</div>;
  }

  // each row's number among the rows of its depth so far (one pass)
  const counts = new Map<number, number>();
  const numbers = rows.map((row) => {
    const n = (counts.get(row.depth) ?? 0) + 1;
    counts.set(row.depth, n);
    return n;
  });

  return (
    <div ref={listRef} role="list" className={cn('flex flex-col', className)} onKeyDown={handleKeyDown}>
      {rows.map((row, i) => (
        <ChapterRow
          key={row.id}
          row={row}
          number={numbers[i]}
          expanded={expanded === row.id}
          actions={renderActions?.(row)}
          detail={expanded === row.id ? renderDetail?.(row) : undefined}
          onActivate={onActivate}
          drag={
            onReorder
              ? {
                  start: () => {
                    dragId.current = row.id;
                  },
                  drop: () => {
                    const from = dragId.current;
                    dragId.current = null;
                    if (from && from !== row.id) {
                      onReorder(from, { beforeId: row.id });
                    }
                  },
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
