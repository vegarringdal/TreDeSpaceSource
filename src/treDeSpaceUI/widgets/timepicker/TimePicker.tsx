import { IconClock } from '@tabler/icons-react';
import { useState } from 'react';
import { PickerField, PickerPopover } from '../PickerField';
import { usePopoverAnchor } from '../usePopoverAnchor';
import { ClockDial } from './clockFace';
import { TimeDigits, type TimeStage } from './TimeDigits';
import { formatTime, nowTime, parseTime, type Time } from './timeMath';

// -----------------------------------------------------------------------------
// types + constants
// -----------------------------------------------------------------------------

/** A time span; either edge may still be unset while the user is picking.
 *  End before start is legal and means the range crosses midnight. */
export type TimeRange = Readonly<{ start: string | null; end: string | null }>;

interface TimePickerBaseProps {
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

export interface SingleTimePickerProps extends TimePickerBaseProps {
  range?: false;
  /** Selected time as 24-hour `"HH:MM"`, or null when empty. */
  value: string | null;
  /** Receives the picked time (`"HH:MM"`), or null when cleared. */
  onChange: (value: string | null) => void;
}

export interface RangeTimePickerProps extends TimePickerBaseProps {
  /** Range mode: the flow runs start hour → start minute → end hour → end
   *  minute; the header digits re-edit any part. No ordering is enforced —
   *  an end before the start is an overnight range. */
  range: true;
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

export type TimePickerProps = SingleTimePickerProps | RangeTimePickerProps;

type Drafts = Readonly<{ start: Time; end: Time }>;

const POP_WIDTH = 216;
const POP_HEIGHT = 252;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Popover drafts from the current value; unset parts start at "now". */
function readDrafts(props: TimePickerProps): Drafts {
  const now = nowTime();
  if (props.range) {
    return { start: parseTime(props.value.start) ?? now, end: parseTime(props.value.end) ?? now };
  }
  return { start: parseTime(props.value) ?? now, end: now };
}

// -----------------------------------------------------------------------------
// render
// -----------------------------------------------------------------------------

/**
 * A compact 24-hour time field with an Android-style analog clock popover:
 * dual-ring hour dial (1–12 outer, 00/13–23 inner), auto-advancing to the
 * minute dial; range mode chains a second endpoint. Values cross the API as
 * `"HH:MM"` strings.
 */
export function TimePicker(props: TimePickerProps) {
  const { minuteStep = 1, placeholder = 'Pick a time…', disabled = false, className = '', tooltip, shortcut } = props;
  const anchor = usePopoverAnchor(POP_HEIGHT);
  const [stage, setStage] = useState<TimeStage>({ endpoint: 'start', mode: 'hour' });
  const [drafts, setDrafts] = useState<Drafts>(() => readDrafts(props));

  const display = props.range
    ? props.value.start == null && props.value.end == null
      ? null
      : `${props.value.start ?? '…'} – ${props.value.end ?? '…'}`
    : props.value;

  const handleToggle = () => {
    if (!anchor.open) {
      setStage({ endpoint: 'start', mode: 'hour' });
      setDrafts(readDrafts(props));
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

  const handlePick = (mode: 'hour' | 'minute', v: number) => {
    const cur = drafts[stage.endpoint];
    const next = { ...drafts, [stage.endpoint]: mode === 'hour' ? { ...cur, h: v } : { ...cur, m: v } };
    setDrafts(next);
    if (props.range) {
      props.onChange({
        start: stage.endpoint === 'start' ? formatTime(next.start) : props.value.start,
        end: stage.endpoint === 'end' ? formatTime(next.end) : props.value.end,
      });
    } else {
      props.onChange(formatTime(next.start));
    }
  };

  const handleCommit = () => {
    if (stage.mode === 'hour') {
      setStage({ ...stage, mode: 'minute' });
    } else if (props.range && stage.endpoint === 'start') {
      setStage({ endpoint: 'end', mode: 'hour' });
    } else {
      anchor.setOpen(false);
    }
  };

  return (
    <div ref={anchor.rootRef} className={`relative text-xs ${className}`} onKeyDown={handleKeyDown}>
      <PickerField
        open={anchor.open}
        icon={<IconClock size={14} className="shrink-0 text-slate-400" />}
        value={display}
        placeholder={placeholder}
        clearLabel="Clear time"
        disabled={disabled}
        tooltip={tooltip}
        shortcut={shortcut}
        onToggle={handleToggle}
        onClear={() => (props.range ? props.onChange({ start: null, end: null }) : props.onChange(null))}
      />

      {anchor.open && (
        <PickerPopover anchor={anchor} width={POP_WIDTH}>
          <TimeDigits start={drafts.start} end={props.range ? drafts.end : null} stage={stage} onStage={setStage} />
          <div className="p-2">
            <ClockDial
              mode={stage.mode}
              hour={drafts[stage.endpoint].h}
              minute={drafts[stage.endpoint].m}
              minuteStep={minuteStep}
              onPick={handlePick}
              onCommit={handleCommit}
            />
          </div>
        </PickerPopover>
      )}
    </div>
  );
}
