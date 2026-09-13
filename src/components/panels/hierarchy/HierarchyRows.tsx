import { IconCube, IconDatabase, IconFolder } from '@tabler/icons-react';
import { useVirtualRows } from '@treDeSpaceUI/lib/useVirtualRows';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { HiddenBadge } from './HiddenBadge';
import { ROW_H, type Row, rowKey } from './hierarchyModel';

/** The visible tree rows: expand carets, folder/mesh icons, selection
 *  highlight and the row click/context handlers. Virtualized: only the rows
 *  in (and just around) the scroller's viewport are mounted, absolutely
 *  positioned at `index * ROW_H` in a spacer of the full height, so a tree
 *  with thousands of open rows re-renders a screenful on every state bump. */
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
  const virtual = useVirtualRows(listRef, rows.length, ROW_H);
  const rowStyle = (i: number) => ({ top: i * ROW_H, height: ROW_H });

  return (
    <div ref={listRef} className="tree scroll-slim min-h-0 flex-1" onScroll={virtual.onScroll}>
      <div style={{ height: virtual.totalH, position: 'relative' }}>
        {rows.slice(virtual.first, virtual.last).map((r, j) => {
          const i = virtual.first + j;
          if (r.store != null) {
            // store (plant) band: pure grouping chrome — no expand, no select,
            // no menu, and no indent (hierarchy levels are unaffected)
            return (
              <div
                key={`s:${r.store}`}
                className="absolute left-0 flex w-full min-w-0 select-none items-center gap-1 border-slate-800 border-t bg-slate-900/70 px-2 text-slate-500"
                style={rowStyle(i)}
              >
                <IconDatabase size={12} className="shrink-0" />
                <span className="min-w-0 truncate text-[10px] uppercase tracking-wider">{r.name}</span>
                <HiddenBadge hidden={r.hidden} />
              </div>
            );
          }
          const k = rowKey(r);
          return (
            <button
              key={k}
              type="button"
              data-key={k}
              className={`tree-row ${r.selected ? 'is-selected' : ''} absolute left-0 flex w-full min-w-0 items-center`}
              style={{ ...rowStyle(i), paddingLeft: `${8 + r.depth * 12}px` }}
              onClick={(e) => onSelect(r, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(r, e);
              }}
            >
              {r.partial && !r.selected && (
                // some (not all) items beneath this row are selected — shown
                // without expanding; the bar itself carries the explanation
                <span
                  className="partial-bar"
                  data-tooltip="Partly selected: some of the items below this row are selected (not all). The row highlights fully once everything beneath it is selected — no need to expand to see where the selection is"
                />
              )}
              {r.hasChildren ? (
                <span
                  className="mr-1 inline-block w-3 shrink-0 cursor-pointer select-none text-slate-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle(r);
                  }}
                >
                  {expanded.has(k) ? '▾' : '▸'}
                </span>
              ) : (
                <span className="mr-1 inline-block w-3 shrink-0" />
              )}
              {r.model === -1 ? (
                <IconFolder size={14} className="mr-1 shrink-0 text-amber-400/80" />
              ) : r.isRoot ? (
                <IconCube size={14} className="mr-1 shrink-0 text-sky-400/80" />
              ) : (
                // dark cube on non-root rows so every level indents the same
                <IconCube size={14} className="mr-1 shrink-0 text-slate-600" />
              )}
              <span className={`min-w-0 truncate ${r.hidden === 'all' ? 'text-slate-500 italic' : ''}`}>{r.name}</span>
              <HiddenBadge hidden={r.hidden} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
