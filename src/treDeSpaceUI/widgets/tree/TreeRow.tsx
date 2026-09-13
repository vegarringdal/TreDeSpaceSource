import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { cn } from '../../lib/cn';
import type { TreeRowExtras, TreeViewRow } from './treeViewTypes';

const BAND_CLS = 'border-slate-800 border-t bg-slate-900/70 text-slate-500';
const TWISTY_SLOT = 'flex h-3.5 w-3.5 shrink-0 items-center justify-center';

type Props = Readonly<{
  row: TreeViewRow;
  style: CSSProperties;
  extras: TreeRowExtras | undefined;
  onToggle?: (row: TreeViewRow) => void;
  onRowClick?: (row: TreeViewRow, e: ReactMouseEvent) => void;
  onRowContextMenu?: (row: TreeViewRow, e: ReactMouseEvent) => void;
}>;

/** One tree line: partial bar, twisty, icon, label, trailing node. The twisty
 *  toggles expansion ONLY — it never touches the selection. */
export function TreeRow({ row, style, extras, onToggle, onRowClick, onRowContextMenu }: Props) {
  const content = (
    <>
      {row.partial && !row.selected && (
        // a 3px bar in an 8px hover target, so its explanation is reachable
        <span
          data-tooltip={row.partialTooltip}
          className="absolute top-0.5 bottom-0.5 left-0 w-2 bg-[linear-gradient(to_right,var(--color-blue-600)_3px,transparent_3px)]"
        />
      )}
      <span className={TWISTY_SLOT}>
        {row.expandable && (
          <span
            className="-m-1 cursor-pointer p-1 text-slate-400 hover:text-blue-300"
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.(row);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                onToggle?.(row);
              }
            }}
          >
            {row.expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          </span>
        )}
      </span>
      {row.icon}
      <span
        className={cn(
          'min-w-0 truncate',
          row.muted && 'text-slate-500 italic',
          row.band && 'text-[10px] uppercase tracking-wider',
        )}
      >
        {row.label}
      </span>
      {row.trailing != null && <span className="ml-auto flex shrink-0 items-center pl-1">{row.trailing}</span>}
    </>
  );

  // selection wins over the band look — a fully selected section highlights
  // like any other row, and only its label keeps the band typography
  const cls = cn(
    'relative flex w-full min-w-0 select-none items-center gap-1.5 text-left text-xs',
    row.selected ? 'bg-blue-950 text-blue-100' : row.band ? BAND_CLS : 'text-slate-200',
    !row.disabled && !row.selected && 'hover:bg-slate-800',
    extras?.className,
  );

  if (row.disabled) {
    return (
      <div className={cls} style={style} data-tooltip={row.tooltip} {...extras?.data}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-key={row.key}
      data-tooltip={row.tooltip}
      className={cn(cls, 'cursor-pointer')}
      style={style}
      draggable={extras?.draggable}
      onDragStart={extras?.onDragStart}
      onDragOver={extras?.onDragOver}
      onDrop={extras?.onDrop}
      onClick={(e) => onRowClick?.(row, e)}
      onContextMenu={(e) => {
        if (onRowContextMenu) {
          e.preventDefault();
          onRowContextMenu(row, e);
        }
      }}
      {...extras?.data}
    >
      {content}
    </button>
  );
}
