import type { DragEvent as ReactDragEvent, ReactNode } from 'react';

export interface TreeViewRow {
  /** Stable identity — the React key, and what the callbacks hand back. */
  key: string;
  /** Indent level (0 = top). */
  depth: number;
  label: ReactNode;
  /** Icon between the twisty and the label (locked to 14×14 by the caller). */
  icon?: ReactNode;
  /** Render the expand/collapse twisty. A leaf keeps the twisty's width, so
   *  every level of the tree lines up. */
  expandable?: boolean;
  expanded?: boolean;
  /** Fully selected — the row highlights. */
  selected?: boolean;
  /** SOME of the rows beneath are selected — a bar at the left edge, so a
   *  collapsed parent still shows where the selection is. */
  partial?: boolean;
  /** Explanation carried by the partial bar itself (it is the hover target). */
  partialTooltip?: string;
  /** Grouping chrome — a dimmed full-width band (a store, a section). Purely
   *  a look: pair with `disabled` for a band that cannot be clicked. */
  band?: boolean;
  /** Dim, italic label — hidden or unavailable content. */
  muted?: boolean;
  /** Not clickable (a band that is pure chrome). */
  disabled?: boolean;
  /** Right-aligned node after the label (a count, a badge). */
  trailing?: ReactNode;
  /** Styled tooltip (data-tooltip) on the row. */
  tooltip?: string;
}

/**
 * Per-row escape hatch for behaviour the tree itself has no opinion on —
 * drag-and-drop and the `data-*` markers a container-level handler reads.
 * Returned by {@link TreeViewProps.rowProps}.
 */
export type TreeRowExtras = Readonly<{
  draggable?: boolean;
  onDragStart?: (e: ReactDragEvent) => void;
  onDragOver?: (e: ReactDragEvent) => void;
  onDrop?: (e: ReactDragEvent) => void;
  /** Classes merged onto the row — a drop-target highlight. */
  className?: string;
  /** `data-*` attributes for the container's own event delegation. */
  data?: Readonly<Record<`data-${string}`, string | undefined>>;
}>;
