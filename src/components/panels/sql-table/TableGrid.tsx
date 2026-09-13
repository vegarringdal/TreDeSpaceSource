import { PanelBody } from '@treDeSpaceUI/dockable';
import { Badge, Button, PanelHeader } from '@treDeSpaceUI/widgets';
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createGridExport } from './gridExport';
import {
  getTableClearOnClose,
  registerTableActions,
  setTableClearOnClose,
  subscribeTablePayload,
  type TablePayload,
} from './sqlTablePanel';
import { TableBody } from './TableBody';
import { TableHeader } from './TableHeader';
import { TableMenu, type TableMenuState } from './TableMenu';
import { useTableLayout } from './useTableLayout';
import { useTableSelection } from './useTableSelection';
import { useTableView } from './useTableView';

/** The populated SQL Table grid: title bar (row/selection counts, Load all),
 *  sticky sortable/filterable header, the virtualized body and the right-click
 *  export/copy menu — behavior state lives in the layout/view/selection hooks. */
export function TableGrid({ payload }: { payload: TablePayload }) {
  const { columns, rows } = payload;
  const view = useTableView(columns, rows);
  const layout = useTableLayout(columns, rows.length, view.viewIdx.length);
  const selection = useTableSelection(columns, view.viewIdx);
  const [menu, setMenu] = useState<TableMenuState | null>(null);
  const clearOnClose = useSyncExternalStore(subscribeTablePayload, getTableClearOnClose);
  const closeMenu = useCallback(() => setMenu(null), []);
  const gridExport = createGridExport(payload, view, selection);

  const filtered = view.viewIdx.length !== rows.length;
  const selectedCount = selection.selected.size;

  const handleContextMenu = (e: ReactMouseEvent): void => {
    if (e.target instanceof HTMLInputElement) {
      return; // the filter inputs keep the browser's own menu (paste)
    }
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  // hotkeys reach the grid's abilities through the panel slot
  useEffect(() => {
    registerTableActions({
      ...gridExport,
      toggleSelectAll: selection.toggleAll,
      loadAll: () => payload.reload?.(),
      toggleClearOnClose: () => setTableClearOnClose(!getTableClearOnClose()),
    });
    return () => registerTableActions(null);
  });

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col overflow-hidden">
      <PanelHeader
        variant="title"
        title={payload.title}
        aside={
          <>
            {selectedCount > 0 && <Badge tone="info">{selectedCount.toLocaleString()} selected</Badge>}
            <span>
              {filtered
                ? `${view.viewIdx.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`
                : `${rows.length.toLocaleString()} rows`}
            </span>
          </>
        }
        actions={
          <>
            {payload.truncated && payload.reload && (
              <Button
                size="sm"
                shortcut="sql.table.loadAll"
                tooltip="Re-run this report without the 50-row cap (max 250,000)"
                onClick={payload.reload}
              >
                Load all
              </Button>
            )}
            <Button
              size="sm"
              active={!clearOnClose}
              shortcut="sql.table.clearOnClose"
              tooltip={
                clearOnClose
                  ? 'Clear on close is ON: closing this panel throws the result away and frees its rows. Click to KEEP it instead — reopening the panel then shows the same rows without re-running the report.'
                  : 'Keep is ON: the result survives closing the panel (its rows stay in memory). Click to clear it on close instead.'
              }
              onClick={() => setTableClearOnClose(!clearOnClose)}
            >
              {clearOnClose ? 'Clear on close' : 'Keep'}
            </Button>
          </>
        }
      />

      <div
        ref={layout.scroller}
        className="min-h-0 flex-1 overflow-auto font-mono text-[11px]"
        onScroll={layout.virtual.onScroll}
        onContextMenu={handleContextMenu}
      >
        <div style={{ width: layout.totalW, minWidth: '100%' }}>
          <TableHeader columns={columns} view={view} layout={layout} selection={selection} />
          <TableBody rows={rows} view={view} layout={layout} selection={selection} />
        </div>
      </div>

      <TableMenu menu={menu} hasSelection={selectedCount > 0} actions={gridExport} onClose={closeMenu} />
    </PanelBody>
  );
}
