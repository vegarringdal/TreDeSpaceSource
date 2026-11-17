import { TreeView } from '@treDeSpaceUI/widgets';
import { type MouseEvent as ReactMouseEvent, type RefObject, useMemo } from 'react';
import { ROW_H, type Row } from './hierarchyModel';
import { toTreeRows } from './hierarchyTreeRows';

/** Indent of a hierarchy level, in px. */
const INDENT = 12;
const PAD_LEFT = 8;

/** The visible tree rows. Virtualized by TreeView: only the rows in (and just
 *  around) the scroller's viewport are mounted, so a tree with thousands of
 *  open rows re-renders a screenful on every state bump. */
export function HierarchyRows({
  rows,
  expanded,
  listRef,
  onToggle,
  onSelect,
  onContextMenu,
}: {
  rows: Row[];
  expanded: Set<string>;
  listRef: RefObject<HTMLDivElement | null>;
  onToggle: (r: Row) => void;
  onSelect: (r: Row, e: ReactMouseEvent) => void;
  onContextMenu: (r: Row, e: ReactMouseEvent) => void;
}) {
  const treeRows = useMemo(() => toTreeRows(rows, expanded), [rows, expanded]);
  // the tree hands back its own row shape; the index is the bridge back to the
  // model row the callbacks need
  const byKey = useMemo(() => new Map(treeRows.map((t, i) => [t.key, rows[i]])), [treeRows, rows]);

  return (
    <TreeView
      rows={treeRows}
      rowHeight={ROW_H}
      indent={INDENT}
      padLeft={PAD_LEFT}
      scrollerRef={listRef}
      className="min-h-0 flex-1"
      onToggle={(t) => {
        const r = byKey.get(t.key);
        if (r) {
          onToggle(r);
        }
      }}
      onRowClick={(t, e) => {
        const r = byKey.get(t.key);
        if (r) {
          onSelect(r, e);
        }
      }}
      onRowContextMenu={(t, e) => {
        const r = byKey.get(t.key);
        if (r) {
          onContextMenu(r, e);
        }
      }}
    />
  );
}
