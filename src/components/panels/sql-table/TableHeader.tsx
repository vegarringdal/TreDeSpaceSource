import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import { ROW_H, type TableLayout } from './useTableLayout';
import type { TableView } from './useTableView';

type TableHeaderProps = Readonly<{
  columns: string[];
  view: TableView;
  layout: TableLayout;
}>;

/** The grid's sticky header: sortable column titles with drag-to-resize grips,
 *  plus the per-column contains-filter row beneath. */
export function TableHeader({ columns, view, layout }: TableHeaderProps) {
  const { colKeys, sort, filters, toggleSort, setFilter } = view;
  const { widths, gutterW, startResize } = layout;

  return (
    <div className="sticky top-0 z-10 border-slate-700 border-b bg-slate-900">
      <div className="flex" style={{ height: ROW_H }}>
        <div
          className="sticky left-0 z-10 shrink-0 border-slate-800 border-r bg-slate-900"
          style={{ width: gutterW }}
        />
        {columns.map((c, i) => (
          <div
            key={colKeys[i]}
            className="relative flex items-center gap-1 border-slate-800 border-r px-1.5 font-medium text-slate-300"
            style={{ width: widths[i] }}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 truncate text-left hover:text-slate-100"
              onClick={() => toggleSort(i)}
              title={c}
            >
              <span className="truncate">{c}</span>
              {sort?.col === i && (sort.dir === 'asc' ? <IconArrowUp size={11} /> : <IconArrowDown size={11} />)}
            </button>
            {/* wide grip straddling the divider (12px hit area) */}
            <div
              className="absolute top-0 -right-1.5 z-10 h-full w-3 cursor-col-resize hover:bg-sky-600/50"
              onPointerDown={(e) => startResize(i, e)}
            />
          </div>
        ))}
      </div>
      <div className="flex border-slate-800 border-t" style={{ height: ROW_H }}>
        <div
          className="sticky left-0 z-10 shrink-0 border-slate-800 border-r bg-slate-900"
          style={{ width: gutterW }}
        />
        {columns.map((_c, i) => (
          <div key={colKeys[i]} className="border-slate-800 border-r" style={{ width: widths[i] }}>
            <input
              value={filters[i]}
              placeholder="filter…"
              spellCheck={false}
              className="h-full w-full bg-slate-950/60 px-1.5 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:bg-slate-950"
              onChange={(e) => setFilter(i, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
