import { PanelBody } from '@treDeSpaceUI/dockable';
import { Button } from '@treDeSpaceUI/widgets';
import type { TablePayload } from './sqlTablePanel';
import { TableBody } from './TableBody';
import { TableHeader } from './TableHeader';
import { OVERSCAN, ROW_H, useTableLayout } from './useTableLayout';
import { useTableSelection } from './useTableSelection';
import { useTableView } from './useTableView';

/** The populated SQL Table grid: title bar (row/selection counts, Load all),
 *  sticky sortable/filterable header and the virtualized body — behavior state
 *  lives in the layout/view/selection hooks. */
export function TableGrid({ payload }: { payload: TablePayload }) {
  const { columns, rows } = payload;
  const layout = useTableLayout(columns, rows.length);
  const view = useTableView(columns, rows);
  const selection = useTableSelection(columns, view.viewIdx);

  const first = Math.max(0, Math.floor(layout.scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(view.viewIdx.length, Math.ceil((layout.scrollTop + layout.viewH) / ROW_H) + OVERSCAN);
  const filtered = view.viewIdx.length !== rows.length;
  const selectedCount = selection.selected.size;

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-slate-800 border-b p-1.5 text-slate-400 text-xs">
        <span className="flex-1 truncate font-medium text-slate-200">{payload.title}</span>
        {selectedCount > 0 && <span className="text-blue-300">{selectedCount.toLocaleString()} selected</span>}
        <span>
          {filtered
            ? `${view.viewIdx.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`
            : `${rows.length.toLocaleString()} rows`}
        </span>
        {payload.truncated && payload.reload && (
          <Button
            className="h-auto min-h-5 py-0.5"
            shortcut="sql.table.loadAll"
            tooltip="Re-run this report without the 50-row cap (max 250,000)"
            onClick={payload.reload}
          >
            Load all
          </Button>
        )}
      </div>

      <div
        ref={layout.scroller}
        className="min-h-0 flex-1 overflow-auto font-mono text-[11px]"
        onScroll={(e) => layout.setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ width: layout.totalW, minWidth: '100%' }}>
          <TableHeader columns={columns} view={view} layout={layout} />
          <TableBody rows={rows} view={view} layout={layout} selection={selection} first={first} last={last} />
        </div>
      </div>
    </PanelBody>
  );
}
