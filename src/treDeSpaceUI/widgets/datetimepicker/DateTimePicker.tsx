import { IconCalendarClock } from '@tabler/icons-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { CalendarGrid } from '../datepicker/CalendarGrid';
import { formatIsoDate, parseIsoDate, todayParts } from '../datepicker/dateMath';
import { PickerField, PickerPopover } from '../PickerField';
import { ClockDial } from '../timepicker/clockFace';
import { formatTime, nowTime, parseTime, type Time } from '../timepicker/timeMath';
import { usePopoverAnchor } from '../usePopoverAnchor';

// -----------------------------------------------------------------------------
// types + constants
// -----------------------------------------------------------------------------

export interface DateTimePickerProps {
  /** Selected moment as ISO local `"yyyy-mm-ddTHH:MM"` (no timezone), or
   *  null when empty. Sorts correctly as a plain string. */
  value: string | null;
  /** Receives the picked moment, or null when cleared. */
  onChange: (value: string | null) => void;
  /** Earliest / latest pickable day (ISO `yyyy-mm-dd`, inclusive) — bounds
   *  the calendar only, not the time of day. */
  min?: string;
  max?: string;
  /** Snap picked minutes to this step (default 1 = exact minute). */
  minuteStep?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Styled tooltip (data-tooltip) on the field. */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
}

type Stage = 'date' | 'hour' | 'minute';

type Draft = Readonly<{ date: string; time: Time }>;

const POP_WIDTH = 220;
const POP_HEIGHT = 260;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function parseDateTime(value: string | null): Draft | null {
  if (value == null) {
    return null;
  }
  const [d, t] = value.split('T');
  const date = parseIsoDate(d);
  const time = parseTime(t ?? null);
  return date != null && time != null ? { date: formatIsoDate(date), time } : null;
}

function freshDraft(value: string | null): Draft {
  return parseDateTime(value) ?? { date: formatIsoDate(todayParts()), time: nowTime() };
}

// -----------------------------------------------------------------------------
// render
// -----------------------------------------------------------------------------

/**
 * Date + time in one field: the calendar picks the day, then the popover
 * advances to the clock (hour → minute → done); the header re-enters either
 * part. Composed from DatePicker's CalendarGrid and TimePicker's ClockDial,
 * value as ISO local `"yyyy-mm-ddTHH:MM"`.
 */
export function DateTimePicker({
  value,
  onChange,
  min,
  max,
  minuteStep = 1,
  placeholder = 'Pick date & time…',
  disabled = false,
  className = '',
  tooltip,
  shortcut,
}: DateTimePickerProps) {
  const anchor = usePopoverAnchor(POP_HEIGHT);
  const [stage, setStage] = useState<Stage>('date');
  const [draft, setDraft] = useState<Draft>(() => freshDraft(value));
  const [view, setView] = useState(() => {
    const base = parseIsoDate(freshDraft(value).date) ?? todayParts();
    return { y: base.y, m: base.m };
  });

  const handleToggle = () => {
    if (!anchor.open) {
      const d = freshDraft(value);
      const base = parseIsoDate(d.date) ?? todayParts();
      setDraft(d);
      setView({ y: base.y, m: base.m });
      setStage('date');
    }
    anchor.setOpen((o) => !o);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!anchor.open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      handleToggle();
    } else if (anchor.open && e.key === 'Escape') {
      e.preventDefault();
      anchor.setOpen(false);
    }
  };

  const emit = (d: Draft) => {
    setDraft(d);
    onChange(`${d.date}T${formatTime(d.time)}`);
  };

  const handlePickDay = (iso: string) => {
    emit({ ...draft, date: iso });
    setStage('hour');
  };

  const handleDialPick = (mode: 'hour' | 'minute', v: number) => {
    emit({ ...draft, time: mode === 'hour' ? { ...draft.time, h: v } : { ...draft.time, m: v } });
  };

  const handleDialCommit = () => {
    if (stage === 'hour') {
      setStage('minute');
    } else {
      anchor.setOpen(false);
    }
  };

  const headerBtn = (active: boolean) =>
    cn(
      'cursor-pointer px-1.5 py-0.5 font-mono leading-none',
      active ? 'bg-blue-950 text-blue-100' : 'text-slate-400 hover:text-slate-200',
    );

  return (
    <div ref={anchor.rootRef} className={`relative text-xs ${className}`} onKeyDown={handleKeyDown}>
      <PickerField
        open={anchor.open}
        icon={<IconCalendarClock size={14} className="shrink-0 text-slate-400" />}
        value={value != null ? value.replace('T', ' ') : null}
        placeholder={placeholder}
        clearLabel="Clear date & time"
        disabled={disabled}
        tooltip={tooltip}
        shortcut={shortcut}
        onToggle={handleToggle}
        onClear={() => onChange(null)}
      />

      {anchor.open && (
        <PickerPopover anchor={anchor} width={POP_WIDTH}>
          <div className="flex items-center justify-center gap-1 border-slate-700 border-b p-1.5">
            <button
              type="button"
              data-tooltip="Pick day"
              className={headerBtn(stage === 'date')}
              onClick={() => setStage('date')}
            >
              {draft.date}
            </button>
            <button
              type="button"
              data-tooltip="Pick hour"
              className={headerBtn(stage === 'hour')}
              onClick={() => setStage('hour')}
            >
              {String(draft.time.h).padStart(2, '0')}
            </button>
            <span className="-mx-1 font-mono text-slate-500 leading-none">:</span>
            <button
              type="button"
              data-tooltip="Pick minute"
              className={headerBtn(stage === 'minute')}
              onClick={() => setStage('minute')}
            >
              {String(draft.time.m).padStart(2, '0')}
            </button>
          </div>

          {stage === 'date' ? (
            <CalendarGrid
              view={view}
              selected={draft.date}
              min={min}
              max={max}
              onPickDay={handlePickDay}
              onViewChange={setView}
            />
          ) : (
            <div className="flex justify-center p-2">
              <ClockDial
                mode={stage}
                hour={draft.time.h}
                minute={draft.time.m}
                minuteStep={minuteStep}
                onPick={handleDialPick}
                onCommit={handleDialCommit}
              />
            </div>
          )}
        </PickerPopover>
      )}
    </div>
  );
}
