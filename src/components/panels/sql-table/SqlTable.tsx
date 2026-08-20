import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { useSyncExternalStore } from 'react';
import { getTablePayload, subscribeTablePayload } from './sqlTablePanel';
import { TableGrid } from './TableGrid';

/** SQL Table: the result of a TABLE report. Virtualized (only visible rows
 *  mounted, so 250k rows stay smooth), click-header sort, per-column contains
 *  filters (AND across columns), drag-to-resize columns, and a row-number
 *  gutter with click/Shift/Ctrl row selection. Fed through setTablePayload. */
export function SqlTable() {
  useMinSize(320, 200);
  const payload = useSyncExternalStore(subscribeTablePayload, getTablePayload);
  if (!payload) {
    return (
      <PanelBody className="panel-body flex h-full items-center justify-center p-4 text-slate-500 text-xs">
        No result yet — run a Table report from the SQL Reports panel.
      </PanelBody>
    );
  }
  return <TableGrid payload={payload} />;
}
