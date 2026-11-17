import { IconMenu2 } from '@tabler/icons-react';
import { Badge, Button, PanelHeader } from '@treDeSpaceUI/widgets';
import { useSyncExternalStore } from 'react';
import { getTableClearOnClose, setTableClearOnClose, subscribeTablePayload, type TablePayload } from './sqlTablePanel';

type TableTitleBarProps = Readonly<{
  payload: TablePayload;
  shownCount: number;
  selectedCount: number;
  isSideMenuOpen: boolean;
  onToggleSideMenu: () => void;
}>;

/** The SQL Table's title strip: the side-menu toggle (hamburger) before the
 *  title, row / selection counts, Load all and Clear on close. */
export function TableTitleBar({
  payload,
  shownCount,
  selectedCount,
  isSideMenuOpen,
  onToggleSideMenu,
}: TableTitleBarProps) {
  const clearOnClose = useSyncExternalStore(subscribeTablePayload, getTableClearOnClose);
  const total = payload.rows.length;
  const rowsText =
    shownCount !== total
      ? `${shownCount.toLocaleString()} of ${total.toLocaleString()} rows`
      : `${total.toLocaleString()} rows`;

  return (
    <PanelHeader
      variant="title"
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <Button
            size="sm"
            iconOnly
            icon={<IconMenu2 />}
            active={isSideMenuOpen}
            shortcut="sql.table.sideMenu"
            tooltip="Side menu (show / hide) — With selection: select, paint or isolate the selected rows in the model, or add them to Set Color as a rule"
            onClick={onToggleSideMenu}
          />
          <span className="min-w-0 truncate">{payload.title}</span>
        </span>
      }
      aside={
        <>
          {selectedCount > 0 && <Badge tone="info">{selectedCount.toLocaleString()} selected</Badge>}
          <span>{rowsText}</span>
        </>
      }
      actions={
        <>
          {payload.truncated && payload.reload && (
            <Button
              size="sm"
              shortcut="sql.table.loadAll"
              tooltip="Re-run this report without the 50-row cap (max 450,000)"
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
  );
}
