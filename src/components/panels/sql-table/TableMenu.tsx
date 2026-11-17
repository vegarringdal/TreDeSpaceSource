import { Menu, type MenuEntry } from '@treDeSpaceUI/widgets';
import type { GridExport } from './gridExport';

export type TableMenuState = { x: number; y: number };

type TableMenuProps = Readonly<{
  menu: TableMenuState | null;
  hasSelection: boolean;
  actions: GridExport;
  onClose: () => void;
}>;

type MenuSpec = Readonly<{
  id: keyof GridExport;
  label: string;
  tooltip: string;
  needsSelection?: boolean;
}>;

const EXPORT_ITEMS: readonly MenuSpec[] = [
  {
    id: 'exportAll',
    label: 'Export to Excel (all)',
    tooltip: 'Every row as shown — column filters and sort applied — to an .xlsx file',
  },
  {
    id: 'exportSelected',
    label: 'Export to Excel (selected rows)',
    tooltip: 'Only the selected rows, in the shown order, to an .xlsx file',
    needsSelection: true,
  },
];
const COPY_ITEMS: readonly MenuSpec[] = [
  {
    id: 'copyAll',
    label: 'Copy to clipboard (all)',
    tooltip: 'Every row as shown, tab-separated with a header row — pastes into a sheet as columns',
  },
  {
    id: 'copySelected',
    label: 'Copy to clipboard (selected rows)',
    tooltip: 'Only the selected rows, tab-separated with a header row',
    needsSelection: true,
  },
];

/** Right-click menu of the SQL Table: export / copy the rows as shown. */
export function TableMenu({ menu, hasSelection, actions, onClose }: TableMenuProps) {
  const entry = (spec: MenuSpec): MenuEntry => ({
    id: spec.id,
    label: spec.label,
    tooltip: spec.tooltip,
    shortcut: `sql.table.${spec.id}`,
    disabled: spec.needsSelection && !hasSelection,
    onSelect: actions[spec.id],
  });

  return (
    <Menu
      anchor={menu}
      minWidth={250}
      onClose={onClose}
      items={[...EXPORT_ITEMS.map(entry), { separator: true }, ...COPY_ITEMS.map(entry)]}
    />
  );
}
