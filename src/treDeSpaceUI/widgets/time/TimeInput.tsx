import { useEffect, useState } from 'react';
import type { LabelledProps } from '../fieldChrome';
import { NumberInput } from '../number/NumberInput';
import { TextInput } from '../text/TextInput';
import { clockCommit, formatClock } from './clock';

export interface TimeInputProps extends LabelledProps {
  /** Seconds. */
  value: number;
  /** Receives seconds, clamped to [min, max]. */
  onChange: (value: number) => void;
  /** Lower bound in seconds (default 0). */
  min?: number;
  /** Upper bound in seconds (default: none). */
  max?: number;
  /** seconds = a stepper in s (default); frames = a stepper in whole frames
   *  at `fps`; mmss = a typed "m:ss.s" field (plain seconds parse too) that
   *  commits on Enter or blur. */
  format?: 'seconds' | 'mmss' | 'frames';
  /** Frames per second for `frames` (default 30). */
  fps?: number;
  /** Stepper step in seconds (default 0.1); `frames` always steps one frame. */
  step?: number;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
}

/**
 * A time field: seconds or frames on a stepper (wheel / drag / type), or a
 * typed m:ss.s clock. The value is always seconds, clamped to [min, max].
 */
export function TimeInput({
  value,
  onChange,
  min = 0,
  max,
  format = 'seconds',
  fps = 30,
  step = 0.1,
  tooltip,
  shortcut,
  ...labelled
}: TimeInputProps) {
  const [text, setText] = useState(formatClock(value));
  useEffect(() => setText(formatClock(value)), [value]);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min, v));

  if (format === 'frames') {
    return (
      <NumberInput
        {...labelled}
        value={Math.round(value * fps)}
        step={1}
        min={Math.round(min * fps)}
        max={max !== undefined ? Math.round(max * fps) : undefined}
        unit="f"
        tooltip={tooltip}
        shortcut={shortcut}
        onChange={(f) => onChange(clamp(f / fps))}
      />
    );
  }
  if (format === 'mmss') {
    const commit = (t: string) => {
      const v = clockCommit(t, value);
      if (v === null) {
        setText(formatClock(value));
        return;
      }
      onChange(clamp(v));
    };
    return (
      <TextInput
        {...labelled}
        value={text}
        clearable={false}
        tooltip={tooltip}
        shortcut={shortcut}
        onChange={setText}
        onCommit={commit}
      />
    );
  }
  return (
    <NumberInput
      {...labelled}
      value={value}
      step={step}
      min={min}
      max={max}
      unit="s"
      tooltip={tooltip}
      shortcut={shortcut}
      onChange={(v) => onChange(clamp(v))}
    />
  );
}
