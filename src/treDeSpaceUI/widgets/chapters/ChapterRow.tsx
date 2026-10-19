import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { ProgressBar } from '../Spinner';
import type { ChapterListRow } from './ChapterList';

type Props = Readonly<{
  row: ChapterListRow;
  /** 1-based number among rows of the same depth */
  number: number;
  expanded: boolean;
  actions: ReactNode;
  detail: ReactNode;
  onActivate: (id: string) => void;
  drag?: { start: () => void; drop: () => void };
}>;

/** One chapter: number/check, title, duration, hover actions, and — when
 *  expanded — the subtitle, progress and detail underneath. */
export function ChapterRow({ row, number, expanded, actions, detail, onActivate, drag }: Props) {
  const done = row.status === 'done';
  const current = row.status === 'current';

  return (
    <div
      role="listitem"
      className={cn(
        'group border-transparent border-l-2',
        current && 'border-sky-400 bg-slate-800/60',
        drag && 'cursor-grab',
      )}
      draggable={drag !== undefined}
      onDragStart={drag?.start}
      onDragOver={(e) => drag && e.preventDefault()}
      onDrop={drag?.drop}
    >
      {row.heading && (
        <div className="px-2 pt-2 pb-0.5 font-semibold text-[10px] text-slate-400 uppercase tracking-wide">
          {row.heading}
        </div>
      )}
      <div
        data-chapter={row.id}
        role="button"
        tabIndex={0}
        className="flex min-w-0 cursor-pointer select-none items-center gap-2 px-2 py-1 text-xs outline-none hover:bg-slate-800 focus-visible:bg-slate-800"
        style={{ paddingLeft: 8 + row.depth * 14 }}
        onClick={() => onActivate(row.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onActivate(row.id);
          }
        }}
      >
        <span className={cn('w-5 shrink-0 text-right tabular-nums', done ? 'text-emerald-400' : 'text-slate-500')}>
          {done ? <IconCheck size={13} className="ml-auto" /> : number}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            done ? 'text-slate-500' : 'text-slate-200',
            current && 'font-medium text-slate-100',
          )}
        >
          {row.title}
        </span>
        {row.warning && <IconAlertTriangle size={13} className="shrink-0 text-amber-400" />}
        {row.note && <span className="shrink-0 text-[10px] text-slate-400">{row.note}</span>}
        {row.duration && <span className="shrink-0 text-slate-500 tabular-nums">{row.duration}</span>}
        {actions != null && (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
            {actions}
          </span>
        )}
      </div>
      {current && row.progress != null && (
        <div className="px-2 pb-1" style={{ paddingLeft: 36 + row.depth * 14 }}>
          <ProgressBar value={row.progress} height={3} />
        </div>
      )}
      {expanded && (row.subtitle || detail) && (
        <div className="px-2 pb-1.5 text-[11px] text-slate-400" style={{ paddingLeft: 36 + row.depth * 14 }}>
          {row.subtitle && <div className="whitespace-pre-wrap">{row.subtitle}</div>}
          {detail}
        </div>
      )}
    </div>
  );
}
