import { cn } from '@treDeSpaceUI/lib/cn';
import { ROW_H, type TableLayout } from './useTableLayout';
import type { TableSelection } from './useTableSelection';
import type { TableView } from './useTableView';

type TableBodyProps = Readonly<{
  rows: unknown[][];
  view: TableView;
  layout: TableLayout;
  selection: TableSelection;
  first: number;
  last: number;
}>;

/** The virtualized grid body: only the rows in the [first, last) view window
 *  are mounted, absolutely positioned inside a full-height spacer. */
export function TableBody({ rows, view, layout, selection, first, last }: TableBodyProps) {
  const { colKeys, viewIdx } = view;
  const { widths, gutterW } = layout;
  const { selected, clickRow } = selection;

  return (
    <div style={{ height: viewIdx.length * ROW_H, position: 'relative' }}>
      {viewIdx.slice(first, last).map((ri, k) => {
        const p = first + k; // view position
        const row = rows[ri];
        const isSel = selected.has(ri);
        return (
          <div
            key={ri}
            className={cn(
              'absolute flex w-full',
              isSel ? 'bg-blue-950/60' : p % 2 ? 'bg-slate-950/40' : 'bg-transparent',
              isSel ? 'hover:bg-blue-900/60' : 'hover:bg-slate-800/50',
            )}
            style={{ top: p * ROW_H, height: ROW_H }}
          >
            <button
              type="button"
              className={cn(
                'sticky left-0 z-[5] shrink-0 select-none border-slate-800 border-r px-1.5 text-right',
                isSel ? 'bg-blue-950 text-blue-100' : 'bg-slate-900 text-slate-400 hover:text-slate-200',
              )}
              style={{ width: gutterW }}
              title="Click to select — Ctrl toggles, Shift ranges"
              onClick={(e) => clickRow(p, e)}
            >
              {p + 1}
            </button>
            {row.map((v, ci) => (
              <div
                key={colKeys[ci] ?? ci}
                className="flex items-center overflow-hidden border-slate-900 border-r px-1.5 text-slate-300"
                style={{ width: widths[ci] }}
                title={v == null ? '' : String(v)}
              >
                <span className="truncate">{v == null ? <span className="text-slate-500">null</span> : String(v)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
