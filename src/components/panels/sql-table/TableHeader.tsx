import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import { Checkbox } from '@treDeSpaceUI/widgets';
import { FilterCell } from './FilterCell';
import type { ColumnKind } from './filterOperators';
import { ROW_H, type TableLayout } from './useTableLayout';
import type { TableSelection } from './useTableSelection';
import type { TableView } from './useTableView';

const KIND_TAG: Readonly<Record<ColumnKind, string>> = { number: '123', text: 'abc' };
const KIND_TOOLTIP: Readonly<Record<ColumnKind, string>> = {
  number: 'Number column: every value is a number, so it offers number filters (>, ≥, <, ≤, between)',
  text: 'Text column: it offers text filters (contains, begins with…)',
};

type TableHeaderProps = Readonly<{
  columns: string[];
  view: TableView;
  layout: TableLayout;
  selection: TableSelection;
}>;

/** The grid's sticky header: a select-all corner above the row numbers,
 *  sortable column titles (with the detected `123` / `abc` kind) and
 *  drag-to-resize grips, plus the per-column filter row beneath. */
export function TableHeader({ columns, view, layout, selection }: TableHeaderProps) {
  const { colKeys, sort, kinds, toggleSort } = view;
  const { widths, gutterW, startResize } = layout;

  return (
    <div className="sticky top-0 z-10 border-slate-700 border-b bg-slate-900">
      <div className="flex" style={{ height: ROW_H }}>
        <div
          className="sticky left-0 z-10 flex shrink-0 items-center justify-center border-slate-800 border-r bg-slate-900"
          style={{ width: gutterW }}
        >
          <Checkbox
            checked={selection.allSelected}
            indeterminate={!selection.allSelected && selection.selected.size > 0}
            onChange={selection.toggleAll}
            shortcut="sql.table.toggleSelectAll"
            tooltip="Select every row shown — click again to deselect all"
          />
        </div>
        {columns.map((c, i) => {
          const kind = kinds[i] ?? 'text';
          return (
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
              <span
                className="shrink-0 border border-slate-700 px-0.5 font-mono font-normal text-[9px] text-slate-500 leading-none"
                data-tooltip={KIND_TOOLTIP[kind]}
              >
                {KIND_TAG[kind]}
              </span>
              {/* wide grip straddling the divider (12px hit area) */}
              <div
                className="absolute top-0 -right-1.5 z-10 h-full w-3 cursor-col-resize hover:bg-sky-600/50"
                onPointerDown={(e) => startResize(i, e)}
              />
            </div>
          );
        })}
      </div>
      <div className="flex border-slate-800 border-t" style={{ height: ROW_H }}>
        <div
          className="sticky left-0 z-10 shrink-0 border-slate-800 border-r bg-slate-900"
          style={{ width: gutterW }}
        />
        {columns.map((c, i) => (
          <FilterCell key={colKeys[i]} view={view} col={i} column={c} width={widths[i]} />
        ))}
      </div>
    </div>
  );
}
