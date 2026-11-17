import { PanelBody } from '@treDeSpaceUI/dockable';
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useState } from 'react';
import { createGridExport } from './gridExport';
import { createSelectionActions } from './selectionActions';
import { getTableClearOnClose, registerTableActions, setTableClearOnClose, type TablePayload } from './sqlTablePanel';
import { TableBody } from './TableBody';
import { TableHeader } from './TableHeader';
import { TableMenu, type TableMenuState } from './TableMenu';
import { TableSideMenu } from './TableSideMenu';
import { TableTitleBar } from './TableTitleBar';
import { useTableLayout } from './useTableLayout';
import { useTableSelection } from './useTableSelection';
import { useTableView } from './useTableView';

/** The populated SQL Table grid: title bar (side-menu toggle, row/selection
 *  counts, Load all), the optional side menu pushing the grid right, sticky
 *  sortable/filterable header, the virtualized body and the right-click
 *  export/copy menu — behavior state lives in the layout/view/selection hooks. */
export function TableGrid({ payload }: { payload: TablePayload }) {
  const { columns, rows } = payload;
  const view = useTableView(columns, rows);
  const layout = useTableLayout(columns, rows.length, view.viewIdx.length);
  const selection = useTableSelection(columns, view.viewIdx);
  const [menu, setMenu] = useState<TableMenuState | null>(null);
  const [isSideMenuOpen, setSideMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const gridExport = createGridExport(payload, view, selection);
  const selectionActions = createSelectionActions(payload, view, selection);

  const selectedCount = selection.selected.size;

  const handleToggleSideMenu = (): void => setSideMenuOpen((open) => !open);

  const handleContextMenu = (e: ReactMouseEvent): void => {
    if (e.target instanceof HTMLInputElement) {
      return; // the filter inputs keep the browser's own menu (paste)
    }
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  // hotkeys reach the grid's abilities through the panel slot (a With
  // selection hotkey with nothing selected says so in the Console)
  useEffect(() => {
    const { disabledReason: _, ...withSelection } = selectionActions;
    registerTableActions({
      ...gridExport,
      ...withSelection,
      toggleSelectAll: selection.toggleAll,
      loadAll: () => payload.reload?.(),
      toggleClearOnClose: () => setTableClearOnClose(!getTableClearOnClose()),
      toggleSideMenu: handleToggleSideMenu,
    });
    return () => registerTableActions(null);
  });

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col overflow-hidden">
      <TableTitleBar
        payload={payload}
        shownCount={view.viewIdx.length}
        selectedCount={selectedCount}
        isSideMenuOpen={isSideMenuOpen}
        onToggleSideMenu={handleToggleSideMenu}
      />

      <div className="flex min-h-0 flex-1">
        {isSideMenuOpen && <TableSideMenu actions={selectionActions} />}
        <div
          ref={layout.scroller}
          className="min-h-0 min-w-0 flex-1 overflow-auto font-mono text-[11px]"
          onScroll={layout.virtual.onScroll}
          onContextMenu={handleContextMenu}
        >
          <div style={{ width: layout.totalW, minWidth: '100%' }}>
            <TableHeader columns={columns} view={view} layout={layout} selection={selection} />
            <TableBody rows={rows} view={view} layout={layout} selection={selection} />
          </div>
        </div>
      </div>

      <TableMenu menu={menu} hasSelection={selectedCount > 0} actions={gridExport} onClose={closeMenu} />
    </PanelBody>
  );
}
