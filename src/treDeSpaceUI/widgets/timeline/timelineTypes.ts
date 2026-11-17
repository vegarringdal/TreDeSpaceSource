import type { ReactNode } from 'react';

/** The visible window: pixels per second and the time at the left edge. */
export interface TimelineView {
  /** zoom, px per second (the widget's own zooms keep it within 4–2000) */
  pxPerSec: number;
  /** time (s) at the left edge of the lanes (the widget's own pans keep it ≥ 0) */
  offset: number;
}

export interface TimelineRow {
  /** handed back by onToggleRow / onOpen / onContextMenu; items and points
   *  name it in their `row` */
  id: string;
  /** 'group' draws a darker band (give it a `span` item for the group's
   *  extent), 'lane' a plain row — the kind changes only the look */
  kind: 'group' | 'lane';
  /** indent level of the label (12 px per level) */
  depth: number;
  /** the name in the label column (any node; truncated) */
  label: ReactNode;
  /** the twisty shows closed. The widget hides nothing: leave the row's
   *  children out of `rows` yourself */
  collapsed?: boolean;
  /** default colour of the row's items (CSS colour), shown as a swatch by
   *  the label */
  tint?: string;
  /** dimmed — display only, edits are not blocked: lock its items for that */
  locked?: boolean;
  /** a collapsible row shows the twisty, which calls `onToggleRow` */
  collapsible?: boolean;
}

export interface TimelineItem {
  /** handed back by the move / resize / select / open callbacks */
  id: string;
  /** the row it is drawn in */
  row: string;
  /** start time (s) */
  start: number;
  /** end time (s); equal to `start` = an instant, drawn `minWidth` wide */
  end: number;
  /** a clip block's text; also the tooltip / aria name (with start → end) */
  label: string;
  /** fill colour (CSS); default the row's tint, then blue */
  tint?: string;
  /** drawn outlined; dragging a selected item moves every selected item
   *  that is not locked or fixed */
  selected?: boolean;
  /** a diagonal hatch over the tint (a reversed or hidden span, say) */
  hatched?: boolean;
  /** leading icon inside a clip block (span bars draw none) */
  icon?: ReactNode;
  /** drawn as a thin span bar instead of a clip block (a group's extent) —
   *  no label, icon or resize edges */
  span?: boolean;
  /** linked to another item (the fields are yours to read): a clip block
   *  shows a ⇢ before its label */
  linkFrom?: { id: string; kind: string };
  /** dimmed; never click-selected, moved or resized, and never a link target
   *  (double-click, right-click and box-select still report it) */
  locked?: boolean;
  /** selectable and openable, but its time follows something else: no
   *  drag, no resize edges, drawn at full strength (unlike `locked`) */
  fixed?: boolean;
  /** drawn at least this many px wide (default 3) — an instant or very short
   *  clip stays readable and clickable; its times do not change */
  minWidth?: number;
}

export interface TimelinePoint {
  /** handed back by onPointsMove / onSelect / onContextMenu */
  id: string;
  /** the row it is drawn in */
  row: string;
  /** time (s) */
  t: number;
  /** 'diamond' = a key; 'marker' = an amber ▼ pin (a pause, a cue) */
  shape: 'diamond' | 'marker';
  /** drawn highlighted; dragging a selected point moves every selected point */
  selected?: boolean;
  /** tooltip / aria name (default "Key") */
  label?: string;
  /** an outlined diamond instead of a filled one (a key that holds, say) */
  hollow?: boolean;
}

/** Where a dragged item would link if dropped (magnetic linking). */
export type DropHint = {
  /** after = its start on the target's end; with = starts together; endsWith = ends together */
  kind: 'after' | 'with' | 'endsWith';
  /** the item it would link to */
  target: string;
};

/** Snapping for item drags, edge resizes and point drags: an edge within
 *  8 px of a target snaps to it, else to a grid line within 8 px. */
export interface TimelineSnap {
  /** off = drags follow the pointer (link hints still show) */
  enabled: boolean;
  /** grid step in seconds (0 = no grid) */
  step: number;
  /** the times to snap to besides the grid — the widget collects none
   *  itself (pass key times, item edges, the playhead…) */
  targets: readonly number[];
}

export interface TimelineProps {
  /** top to bottom; leave out the children of a collapsed row */
  rows: readonly TimelineRow[];
  /** span bars and clip blocks, each in the row its `row` names */
  items: readonly TimelineItem[];
  /** key diamonds and markers, each in the row its `row` names */
  points: readonly TimelinePoint[];
  /** playhead time (s): the red line over the ruler and lanes */
  playhead: number;
  /** total length (s) — the ruler is dimmed past it; nothing is clamped to it */
  duration: number;
  /** the visible window — controlled: store what onViewChange reports */
  view: TimelineView;
  /** an in/out range drawn on the ruler (see onRangeChange), or null */
  range?: { from: number; to: number } | null;
  /** the lanes outside this window are dimmed — display only, edits are not
   *  blocked: lock the items there for that */
  dimOutside?: { from: number; to: number } | null;
  /** a dashed end mark at this time (where playback ends), or null */
  endMark?: number | null;
  /** snapping for drags and resizes (absent = off) */
  snap?: TimelineSnap;
  /** width of the label column, px (default 150) */
  labelWidth?: number;
  /** given: the label column's edge can be dragged; called with the new
   *  width while dragging (clamped 80–600 px) */
  onLabelWidthChange?: (px: number) => void;
  /** row height, px (default 22) */
  rowHeight?: number;
  /** time read-out format for the ruler / tooltips (default "12.5s" / "1:05") */
  format?: (t: number) => string;
  /** Ctrl+wheel and +/− zoom; Shift+wheel (over the ruler, any wheel) pans;
   *  so do ←/→ to keep the playhead in sight, and a drag held at or past an
   *  edge of the lanes or the ruler */
  onViewChange: (view: TimelineView) => void;
  /** the new playhead time (s, ≥ 0): ruler click / drag, empty-lane click, ←/→ */
  onSeek: (t: number) => void;
  /** items dragged by dt (s) since the press — the time under the pointer now
   *  minus at the press (the view may have panned), not per event: preview on
   *  'drag', commit on 'end'. Pressing a selected item drags every selected
   *  movable item. dropHint = the link a drop here would make (null with Alt) */
  onItemsMove: (ids: readonly string[], dt: number, dropHint: DropHint | null, phase: 'drag' | 'end') => void;
  /** an item edge dragged to time t; shift = the alternative edit */
  onItemResize: (id: string, edge: 'start' | 'end', t: number, shift: boolean, phase: 'drag' | 'end') => void;
  /** points dragged by dt (s) since the press, snapped like items; pressing a
   *  selected point drags every selected point */
  onPointsMove: (ids: readonly string[], dt: number, phase: 'drag' | 'end') => void;
  /** a click on an item / point (Shift/Ctrl/⌘ = additive), a box-select
   *  (Shift/Ctrl = additive) or a plain empty-lane click (empty lists).
   *  additive = merge or toggle into your selection yourself */
  onSelect: (sel: { items: string[]; points: string[] }, additive: boolean) => void;
  /** a collapsible row's twisty was clicked: flip its `collapsed` and add or
   *  drop its children in `rows` */
  onToggleRow?: (id: string) => void;
  /** double-click on an item or a row's label (points have none) */
  onOpen: (target: { kind: 'item' | 'row'; id: string }) => void;
  /** right-click: what was hit ('empty' = lane background), the time under the
   *  pointer, and the viewport position (a Menu anchor) */
  onContextMenu: (
    target: { kind: 'item' | 'row' | 'point' | 'empty'; id?: string; t: number },
    at: { x: number; y: number },
  ) => void;
  /** Shift+drag on the ruler reports an in/out range, Shift+click clears it
   *  (null); without it Shift+drag just scrubs */
  onRangeChange?: (range: { from: number; to: number } | null) => void;
  className?: string;
}
