import { type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject, useRef } from 'react';
import { cn } from '../../lib/cn';
import { useVirtualRows } from '../../lib/useVirtualRows';
import { EmptyState } from '../EmptyState';
import { TreeRow } from './TreeRow';
import type { TreeRowExtras, TreeViewRow } from './treeViewTypes';

export type { TreeRowExtras, TreeViewRow } from './treeViewTypes';

export interface TreeViewProps {
  /** The rows that are VISIBLE right now, already flattened by the caller —
   *  the tree draws, it does not own the model. Collapsed subtrees are simply
   *  absent, so a lazily-loaded tree costs nothing until it is expanded. */
  rows: readonly TreeViewRow[];
  onToggle?: (row: TreeViewRow) => void;
  onRowClick?: (row: TreeViewRow, e: ReactMouseEvent) => void;
  onRowContextMenu?: (row: TreeViewRow, e: ReactMouseEvent) => void;
  /** Fixed row height in px — turns on virtualization (only the rows in view
   *  are mounted). Omit for a short tree that can render whole. */
  rowHeight?: number;
  /** px of indent per depth level (default 14). */
  indent?: number;
  /** px of padding before a depth-0 row (default 6). */
  padLeft?: number;
  /** Own the scroller ref to scroll a row into view (a reveal). */
  scrollerRef?: RefObject<HTMLDivElement | null>;
  /** Drag-and-drop and `data-*` markers, per row. */
  rowProps?: (row: TreeViewRow) => TreeRowExtras | undefined;
  /** Shown instead of the rows when there are none. */
  emptyText?: ReactNode;
  className?: string;
}

/**
 * The app's tree list: indent, twisty, selection and partial-selection
 * highlighting over a flat list of visible rows. Virtualized when `rowHeight`
 * is given — rows are then absolutely positioned inside a full-height spacer,
 * so a tree with thousands of open rows still re-renders a screenful.
 */
export function TreeView({
  rows,
  onToggle,
  onRowClick,
  onRowContextMenu,
  rowHeight,
  indent = 14,
  padLeft = 6,
  scrollerRef,
  rowProps,
  emptyText,
  className = '',
}: TreeViewProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const scroller = scrollerRef ?? ownRef;
  // the hook is unconditional (rules of hooks); a rowHeight of 0 rows keeps it
  // inert when the caller renders the whole list
  const virtual = useVirtualRows(scroller, rowHeight ? rows.length : 0, rowHeight || 1);
  const virtualized = rowHeight != null;
  const shown = virtualized ? rows.slice(virtual.first, virtual.last) : rows;

  const styleOf = (i: number): CSSProperties => {
    const paddingLeft = padLeft + rows[i].depth * indent;
    if (virtualized) {
      return { paddingLeft, position: 'absolute', left: 0, top: i * (rowHeight ?? 0), height: rowHeight };
    }
    return { paddingLeft, paddingTop: 2, paddingBottom: 2 };
  };

  const body = shown.map((r, j) => {
    const i = virtualized ? virtual.first + j : j;
    return (
      <TreeRow
        key={r.key}
        row={r}
        style={styleOf(i)}
        extras={rowProps?.(r)}
        onToggle={onToggle}
        onRowClick={onRowClick}
        onRowContextMenu={onRowContextMenu}
      />
    );
  });

  return (
    <div
      ref={scroller}
      className={cn('overflow-y-auto', className)}
      onScroll={virtualized ? virtual.onScroll : undefined}
    >
      {rows.length === 0 && emptyText != null ? (
        <EmptyState className="px-2">{emptyText}</EmptyState>
      ) : virtualized ? (
        <div className="relative" style={{ height: virtual.totalH }}>
          {body}
        </div>
      ) : (
        body
      )}
    </div>
  );
}
