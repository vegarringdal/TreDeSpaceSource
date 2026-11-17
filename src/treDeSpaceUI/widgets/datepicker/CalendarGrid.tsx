import { useState } from 'react';
import { cn } from '../../lib/cn';
import { formatIsoDate, monthGrid, todayParts } from './dateMath';

// -----------------------------------------------------------------------------
// types + constants
// -----------------------------------------------------------------------------

export interface CalendarGridProps {
  /** Displayed month. */
  view: { y: number; m: number };
  /** Selected day (ISO) — rendered highlighted when visible. */
  selected: string | null;
  /** Range mode: paint the endpoints and the span between them (start set,
   *  end open → hovering previews the span); `selected` is ignored. */
  range?: Readonly<{ start: string | null; end: string | null }>;
  /** Earliest / latest pickable day (ISO, inclusive). */
  min?: string;
  max?: string;
  onPickDay: (iso: string) => void;
  onViewChange: (view: { y: number; m: number }) => void;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const NAV_BTN =
  'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-slate-400 hover:bg-slate-700 hover:text-slate-100';

const EDGE_CLS = 'bg-blue-400 font-semibold text-slate-950';
const FILL_CLS = 'bg-blue-950 text-blue-100';

/** Monday-first month grid with an ISO week-number column, plus a month/year
 *  quick-jump panel behind the header label. */
export function CalendarGrid({ view, selected, range, min, max, onPickDay, onViewChange }: CalendarGridProps) {
  const [jump, setJump] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const today = formatIsoDate(todayParts());
  const weeks = monthGrid(view.y, view.m);

  /** Range paint for a day: endpoint chip, span fill, or nothing. While the
   *  end is still open the hovered day previews the span. */
  const rangeCls = (iso: string): string | null => {
    if (range?.start == null) {
      return null;
    }
    const end = range.end ?? hover;
    if (end == null) {
      return iso === range.start ? EDGE_CLS : null;
    }
    const [lo, hi] = range.start <= end ? [range.start, end] : [end, range.start];
    if (iso === lo || iso === hi) {
      return EDGE_CLS;
    }
    return iso > lo && iso < hi ? FILL_CLS : null;
  };

  const stepMonth = (delta: number) => {
    const i = view.y * 12 + (view.m - 1) + delta;
    onViewChange({ y: Math.floor(i / 12), m: (((i % 12) + 12) % 12) + 1 });
  };

  const isDisabled = (iso: string): boolean => (min != null && iso < min) || (max != null && iso > max);

  const header = (
    <div className="flex items-center gap-0.5 border-slate-700 border-b p-1">
      <button type="button" data-tooltip="Previous month" className={NAV_BTN} onClick={() => stepMonth(-1)}>
        ‹
      </button>
      <button
        type="button"
        data-tooltip="Pick month / year"
        className="h-6 flex-1 cursor-pointer text-center font-semibold hover:bg-slate-700"
        onClick={() => setJump((j) => !j)}
      >
        {MONTHS[view.m - 1]} {view.y}
      </button>
      <button type="button" data-tooltip="Next month" className={NAV_BTN} onClick={() => stepMonth(1)}>
        ›
      </button>
    </div>
  );

  if (jump) {
    return (
      <div>
        {header}
        <div className="flex items-center justify-center gap-2 p-2">
          <button
            type="button"
            data-tooltip="Previous year"
            className={NAV_BTN}
            onClick={() => onViewChange({ ...view, y: view.y - 1 })}
          >
            ‹
          </button>
          <span className="w-12 text-center font-semibold">{view.y}</span>
          <button
            type="button"
            data-tooltip="Next year"
            className={NAV_BTN}
            onClick={() => onViewChange({ ...view, y: view.y + 1 })}
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 p-2 pt-0">
          {MONTHS.map((name, i) => (
            <button
              key={name}
              type="button"
              className={cn(
                'h-6 cursor-pointer px-1',
                i + 1 === view.m ? 'bg-blue-400 font-semibold text-slate-950' : 'hover:bg-slate-700',
              )}
              onClick={() => {
                onViewChange({ y: view.y, m: i + 1 });
                setJump(false);
              }}
            >
              {name.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div
        className="grid grid-cols-[28px_repeat(7,26px)] p-1 pt-1.5"
        onPointerLeave={range != null ? () => setHover(null) : undefined}
      >
        <span className="pr-1.5 text-right text-[10px] text-slate-500 leading-6">wk</span>
        {WEEKDAYS.map((d) => (
          <span key={d} className="text-center text-slate-400 leading-6">
            {d}
          </span>
        ))}
        {weeks.map((w) => [
          <span key={`w${w.week}${w.days[0].iso}`} className="pr-1.5 text-right text-[10px] text-slate-500 leading-6">
            {w.week}
          </span>,
          ...w.days.map((d) => (
            <button
              key={d.iso}
              type="button"
              disabled={isDisabled(d.iso)}
              className={cn(
                'flex h-6 cursor-pointer select-none items-center justify-center',
                d.inMonth ? 'text-slate-200' : 'text-slate-500',
                (range != null ? rangeCls(d.iso) : d.iso === selected ? EDGE_CLS : null) ??
                  cn('hover:bg-slate-700', d.iso === today && 'border border-blue-400'),
                'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
              )}
              onPointerEnter={range != null ? () => setHover(d.iso) : undefined}
              onClick={() => onPickDay(d.iso)}
            >
              {d.parts.d}
            </button>
          )),
        ])}
      </div>
    </div>
  );
}
