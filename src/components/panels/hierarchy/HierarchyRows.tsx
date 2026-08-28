import { IconCube, IconDatabase, IconFolder } from '@tabler/icons-react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { HiddenBadge } from './HiddenBadge';
import { groupKey, keyOf, type Row } from './hierarchyModel';

/** The visible tree rows: expand carets, folder/mesh icons, selection
 *  highlight and the row click/context handlers. */
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
  listRef: RefObject<HTMLUListElement | null>;
  onToggle: (r: Row) => void;
  onSelect: (r: Row, e: ReactMouseEvent) => void;
  onContextMenu: (r: Row, e: ReactMouseEvent) => void;
}) {
  return (
    <ul ref={listRef} className="tree scroll-slim min-h-0 flex-1">
      {rows.map((r) => {
        if (r.store != null) {
          // store (plant) band: pure grouping chrome — no expand, no select,
          // no menu, and no indent (hierarchy levels are unaffected)
          return (
            <li key={`s:${r.store}`}>
              <div className="flex w-full min-w-0 select-none items-center gap-1 border-slate-800 border-t bg-slate-900/70 px-2 py-0.5 text-slate-500">
                <IconDatabase size={12} className="shrink-0" />
                <span className="min-w-0 truncate text-[10px] uppercase tracking-wider">{r.name}</span>
                <HiddenBadge hidden={r.hidden} />
              </div>
            </li>
          );
        }
        const k = r.model === -1 ? groupKey(r.group!, r.inStore) : keyOf(r.model, r.entry);
        return (
          <li key={k}>
            <button
              type="button"
              data-key={k}
              className={`${r.selected ? 'tree-row is-selected' : 'tree-row'} flex w-full min-w-0 items-center`}
              style={{ paddingLeft: `${8 + r.depth * 12}px` }}
              onClick={(e) => onSelect(r, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(r, e);
              }}
            >
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
          </li>
        );
      })}
    </ul>
  );
}
