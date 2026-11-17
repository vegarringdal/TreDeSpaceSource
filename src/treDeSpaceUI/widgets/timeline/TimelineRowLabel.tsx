import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { TimelineRow } from './timelineTypes';

type Props = Readonly<{
  row: TimelineRow;
  width: number;
  height: number;
  onToggle?: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (e: ReactMouseEvent, id: string) => void;
}>;

/** The label cell of a row: twisty, tint swatch, name. */
export function TimelineRowLabel({ row, width, height, onToggle, onOpen, onMenu }: Props) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 truncate border-slate-700 border-r pr-1 text-[11px] text-slate-300"
      style={{ width, height, paddingLeft: 4 + row.depth * 12 }}
      onDoubleClick={() => onOpen(row.id)}
      onContextMenu={(e) => onMenu(e, row.id)}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {row.collapsible ? (
        <button
          type="button"
          className="cursor-pointer text-slate-500 hover:text-sky-300"
          onClick={() => onToggle?.(row.id)}
        >
          {row.collapsed ? <IconChevronRight size={11} /> : <IconChevronDown size={11} />}
        </button>
      ) : (
        <span className="w-[11px]" />
      )}
      {row.tint && <span className="h-2.5 w-1 shrink-0" style={{ background: row.tint }} />}
      <span className="min-w-0 truncate">{row.label}</span>
    </div>
  );
}
