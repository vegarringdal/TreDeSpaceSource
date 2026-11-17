import { cn } from '../../lib/cn';
import type { MenuItem } from './menuTypes';

/** One menu entry. Picking it closes the menu first, so a handler that opens
 *  a dialog never leaves the menu floating behind it. */
export function MenuEntryButton({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      data-tooltip={item.tooltip}
      data-shortcut={item.shortcut}
      className={cn(
        'flex cursor-pointer items-center gap-2 px-3 py-1 text-left disabled:cursor-default disabled:text-slate-600 disabled:hover:bg-transparent',
        item.danger ? 'text-red-300 hover:bg-red-950/60' : 'text-slate-200 hover:bg-slate-800',
      )}
      onClick={() => {
        onClose();
        item.onSelect();
      }}
    >
      {item.icon != null && (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
          {item.icon}
        </span>
      )}
      {item.label}
    </button>
  );
}
