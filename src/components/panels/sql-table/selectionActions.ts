import { sqlReportsActions } from '../../../state/sqlReports/sqlReports.actions';
import { consoleActions } from '../console/console.actions';
import { multiColorActions } from '../multi-color/multiColor.actions';
import {
  COLOR_COLUMN,
  findColumn,
  multiFilterValue,
  NAME_COLUMN,
  packRowNames,
  type RowName,
  rowNames,
} from './selectedRowNames';
import type { TablePayload } from './sqlTablePanel';
import type { TableSelection } from './useTableSelection';
import type { TableView } from './useTableView';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type SelectionActionId = 'asSelection' | 'asWhite' | 'asHidden' | 'asTransparent' | 'addSetColor';

export type SelectionActions = Readonly<
  Record<SelectionActionId, () => void> & {
    /** Why the buttons are off (no fullname column, no rows selected), or null. */
    disabledReason: string | null;
  }
>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Rule colour for rows without a `fullname_color` — the coloring buttons' yellow. */
const DEFAULT_RULE_COLOR = '#ffff00';

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function disabledReasonFor(nameCol: number, selectedCount: number): string | null {
  if (nameCol < 0) {
    return 'Needs a fullname column';
  }
  if (selectedCount === 0) {
    return 'Select rows first';
  }

  return null;
}

/** The side menu's "With selection" buttons: the selected rows AS SHOWN
 *  (sort + column filters, like the export menu) painted, isolated or
 *  selected in the model through the same applies as the SQL color buttons,
 *  or added to Set Color as one Multi rule. */
export function createSelectionActions(
  payload: TablePayload,
  view: TableView,
  selection: TableSelection,
): SelectionActions {
  const { columns, rows, title } = payload;
  const nameCol = findColumn(columns, NAME_COLUMN);
  const colorCol = findColumn(columns, COLOR_COLUMN);
  const disabledReason = disabledReasonFor(nameCol, selection.selected.size);

  const pickNames = (): RowName[] => {
    if (nameCol < 0) {
      consoleActions.log('warn', 'SQL Table: the result has no fullname column');
      return [];
    }
    const idx = view.viewIdx.filter((ri) => selection.selected.has(ri));
    const names = rowNames(rows, idx, nameCol, colorCol);
    if (!names.length) {
      consoleActions.log('warn', 'SQL Table: no selected row shown has a fullname');
    }
    return names;
  };

  const paint = async (apply: (names: RowName[]) => Promise<void>): Promise<void> => {
    const names = pickNames();
    if (names.length) {
      await apply(names);
    }
  };

  const asSelection = async (names: RowName[]): Promise<void> => {
    const r = await sqlReportsActions.colorSelection(packRowNames(names));
    const missed = r.missed ? ` (${r.missed} not in the model)` : '';
    consoleActions.log('info', `SQL Table: selected ${r.matched} of ${names.length} fullname(s)${missed}`);
  };

  const addSetColor = (): void => {
    const names = pickNames();
    if (!names.length) {
      return;
    }
    multiColorActions.appendRule({
      comment: `SQL Table: ${title} (${names.length.toLocaleString()} rows)`,
      enabled: true,
      filters: [{ op: 'append', mode: 'multi', value: multiFilterValue(names), comment: '', level: 0 }],
      color: DEFAULT_RULE_COLOR,
      opacity: 1,
      store: '',
    });
    consoleActions.log('info', `SQL Table: added a Set Color rule with ${names.length.toLocaleString()} fullname(s)`);
  };

  return {
    disabledReason,
    asSelection: () => void paint(asSelection),
    asWhite: () => void paint((n) => sqlReportsActions.colorWhite(packRowNames(n))),
    asHidden: () => void paint((n) => sqlReportsActions.colorHidden(packRowNames(n))),
    asTransparent: () => void paint((n) => sqlReportsActions.colorTransparent(packRowNames(n))),
    addSetColor,
  };
}
