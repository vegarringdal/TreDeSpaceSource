import { IconCalendarEvent } from '@tabler/icons-react';
import { useState } from 'react';
import { PickerField, PickerPopover } from '../PickerField';
import { usePopoverAnchor } from '../usePopoverAnchor';
import { CalendarGrid } from './CalendarGrid';
import { parseIsoDate, todayParts } from './dateMath';

// -----------------------------------------------------------------------------
// types + constants
// -----------------------------------------------------------------------------

/** A day span; either edge may still be unset while the user is picking. */
export type DateRange = Readonly<{ start: string | null; end: string | null }>;

interface DatePickerBaseProps {
  /** Earliest / latest pickable day (ISO `yyyy-mm-dd`, inclusive). */
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Styled tooltip (data-tooltip) on the field. */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
}

export interface SingleDatePickerProps extends DatePickerBaseProps {
  range?: false;
  /** Selected day as ISO `yyyy-mm-dd`, or null when empty. */
  value: string | null;
  /** Receives the picked day, or null when cleared. */
  onChange: (value: string | null) => void;
}

export interface RangeDatePickerProps extends DatePickerBaseProps {
  /** Range mode: the first click picks the start, the second the end
   *  (auto-swapped when clicked backwards); hovering previews the span. */
  range: true;
  value: DateRange;
  onChange: (value: DateRange) => void;
}

export type DatePickerProps = SingleDatePickerProps | RangeDatePickerProps;

const POP_WIDTH = 220;
const POP_HEIGHT = 210;

// -----------------------------------------------------------------------------
// render
// -----------------------------------------------------------------------------

/**
 * A compact calendar field in the dock's visual language: Monday-first weeks
 * with an ISO 8601 week-number column, single day or day range. Values cross
 * the API as ISO `yyyy-mm-dd` strings (never Date objects), so timezones
 * cannot shift days.
 */
export function DatePicker(props: DatePickerProps) {
  const { min, max, placeholder = 'Pick a date…', disabled = false, className = '', tooltip, shortcut } = props;
  const anchor = usePopoverAnchor(POP_HEIGHT);

  const firstSet = props.range ? (props.value.start ?? props.value.end) : props.value;
  const [view, setView] = useState(() => {
    const base = parseIsoDate(firstSet) ?? todayParts();
    return { y: base.y, m: base.m };
  });

  const display = props.range
    ? props.value.start == null && props.value.end == null
      ? null
      : `${props.value.start ?? '…'} – ${props.value.end ?? '…'}`
    : props.value;

  const handleToggle = () => {
    if (!anchor.open) {
      const base = parseIsoDate(firstSet) ?? todayParts();
      setView({ y: base.y, m: base.m });
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

  const handlePickDay = (iso: string) => {
    if (!props.range) {
      props.onChange(iso);
      anchor.setOpen(false);
      return;
    }
    const { start, end } = props.value;
    if (start == null || end != null) {
      props.onChange({ start: iso, end: null });
      return;
    }
    props.onChange(iso < start ? { start: iso, end: start } : { start, end: iso });
    anchor.setOpen(false);
  };

  return (
    <div ref={anchor.rootRef} className={`relative text-xs ${className}`} onKeyDown={handleKeyDown}>
      <PickerField
        open={anchor.open}
        icon={<IconCalendarEvent size={14} className="shrink-0 text-slate-400" />}
        value={display}
        placeholder={placeholder}
        clearLabel="Clear date"
        disabled={disabled}
        tooltip={tooltip}
        shortcut={shortcut}
        onToggle={handleToggle}
        onClear={() => (props.range ? props.onChange({ start: null, end: null }) : props.onChange(null))}
      />

      {anchor.open && (
        <PickerPopover anchor={anchor} width={POP_WIDTH}>
          <CalendarGrid
            view={view}
            selected={props.range ? null : props.value}
            range={props.range ? props.value : undefined}
            min={min}
            max={max}
            onPickDay={handlePickDay}
            onViewChange={setView}
          />
        </PickerPopover>
      )}
    </div>
  );
}
