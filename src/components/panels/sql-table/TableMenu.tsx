import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { GridExport } from './gridExport';

export type TableMenuState = { x: number; y: number };

type TableMenuProps = Readonly<{
  menu: TableMenuState | null;
  hasSelection: boolean;
  actions: GridExport;
  onClose: () => void;
}>;

type MenuItem = Readonly<{
  id: keyof GridExport;
  label: string;
  tooltip: string;
  needsSelection?: boolean;
}>;

/** Keeps the menu inside the viewport when opened near the right/bottom edge. */
const MENU_W = 250;
const MENU_H = 130;

const EXPORT_ITEMS: readonly MenuItem[] = [
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
const COPY_ITEMS: readonly MenuItem[] = [
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

/** Right-click menu of the SQL Table: export / copy the rows as shown.
 *  Body-portaled so the grid's scroll clipping cannot cut it off; closes on
 *  any outside pointer press. */
export function TableMenu({ menu, hasSelection, actions, onClose }: TableMenuProps) {
  useEffect(() => {
    if (!menu) {
      return;
    }
    window.addEventListener('pointerdown', onClose);
    return () => window.removeEventListener('pointerdown', onClose);
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }

  const renderItems = (items: readonly MenuItem[]) =>
    items.map((item) => (
      <button
        key={item.id}
        type="button"
        disabled={item.needsSelection && !hasSelection}
        className="px-3 py-1 text-left text-slate-200 hover:bg-slate-800 disabled:text-slate-500 disabled:hover:bg-transparent"
        data-shortcut={`sql.table.${item.id}`}
        data-tooltip={item.tooltip}
        onClick={() => {
          onClose();
          actions[item.id]();
        }}
      >
        {item.label}
      </button>
    ));

  return createPortal(
    <div
      className="fixed z-[3000] flex flex-col border border-slate-700 bg-slate-900 py-1 text-xs shadow-lg"
      style={{ left: Math.min(menu.x, window.innerWidth - MENU_W), top: Math.min(menu.y, window.innerHeight - MENU_H) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {renderItems(EXPORT_ITEMS)}
      <div className="my-1 border-slate-700 border-t" />
      {renderItems(COPY_ITEMS)}
    </div>,
    document.body,
  );
}
