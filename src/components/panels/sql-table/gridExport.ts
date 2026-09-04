import { copyText } from '../../../lib/clipboard';
import { downloadBinary } from '../../../lib/download';
import { exportFileName, toTsv } from '../../../lib/tableExport';
import { buildXlsx, XLSX_MIME } from '../../../lib/xlsx';
import { dialogs } from '../../dialogs/dialogs.actions';
import { consoleActions } from '../console/console.actions';
import type { TablePayload } from './sqlTablePanel';
import type { TableSelection } from './useTableSelection';
import type { TableView } from './useTableView';

export type GridExport = Readonly<{
  exportAll: () => void;
  exportSelected: () => void;
  copyAll: () => void;
  copySelected: () => void;
}>;

type RowScope = 'all' | 'selected';

/** Let the loading dialog paint before a long synchronous build. */
const yieldToPaint = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Export / copy the grid AS SHOWN: the view's order (sort) and rows (column
 *  filters). "Selected" keeps only the selected rows, in that same order. */
export function createGridExport(payload: TablePayload, view: TableView, selection: TableSelection): GridExport {
  const { columns, rows, title } = payload;

  const scopeRows = (scope: RowScope): unknown[][] => {
    const idx = scope === 'all' ? view.viewIdx : view.viewIdx.filter((ri) => selection.selected.has(ri));
    return idx.map((ri) => rows[ri]);
  };

  const exportExcel = async (scope: RowScope): Promise<void> => {
    const out = scopeRows(scope);
    if (!out.length) {
      consoleActions.log('warn', `SQL Table: no ${scope} rows to export`);
      return;
    }
    const fileName = exportFileName(title, 'xlsx');
    dialogs.loading(`Building ${fileName}…`, 'SQL Table');
    try {
      await yieldToPaint();
      const bytes = buildXlsx(columns, out, title);
      downloadBinary(fileName, bytes.buffer, XLSX_MIME);
      consoleActions.log('info', `SQL Table: exported ${out.length.toLocaleString()} ${scope} row(s) to ${fileName}`);
    } finally {
      dialogs.hideLoading();
    }
  };

  const copy = async (scope: RowScope): Promise<void> => {
    const out = scopeRows(scope);
    if (!out.length) {
      consoleActions.log('warn', `SQL Table: no ${scope} rows to copy`);
      return;
    }
    const result = await copyText(toTsv(columns, out));
    if (result.error) {
      dialogs.error(result.error, 'Copy failed');
      return;
    }
    consoleActions.log('info', `SQL Table: copied ${out.length.toLocaleString()} ${scope} row(s) to the clipboard`);
  };

  return {
    exportAll: () => void exportExcel('all'),
    exportSelected: () => void exportExcel('selected'),
    copyAll: () => void copy('all'),
    copySelected: () => void copy('selected'),
  };
}
