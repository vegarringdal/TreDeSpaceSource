import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { NumberInput } from './number/NumberInput';

/** An x/y/z triple — a point, a size, an axis. */
export type Vec3 = readonly [number, number, number];

export interface Vec3InputProps {
  /** The x/y/z triple shown in the three fields. */
  value: Vec3;
  /** Receives the whole triple with the edited component replaced. */
  onChange: (value: [number, number, number]) => void;
  /** Row caption in a fixed column before the fields. */
  label?: ReactNode;
  /** Label column width in px (default 48) — share one value down a form. */
  labelWidth?: number;
  /** Stepper step for all three fields (default 0.5). */
  step?: number;
  /** Lower bound for each component. */
  min?: number;
  /** Upper bound for each component. */
  max?: number;
  /** Decimals shown/kept; derived from step when omitted. */
  precision?: number;
  /** Suffix after each value, e.g. "m". */
  unit?: string;
  /** Per-axis styled tooltips, in x/y/z order. */
  tooltips?: readonly [string, string, string];
  /** Grey out all three fields. */
  disabled?: boolean;
  /** Extra classes on the row (a grid: label column + three fields). */
  className?: string;
}

const AXES = [0, 1, 2] as const;

/** Three steppers on one row for a 3-component value — a clip shape's centre,
 *  size or axis. The label column keeps stacked rows aligned. */
export function Vec3Input({
  value,
  onChange,
  label,
  labelWidth = 48,
  step = 0.5,
  min,
  max,
  precision,
  unit,
  tooltips,
  disabled = false,
  className = '',
}: Vec3InputProps) {
  const setAxis = (axis: number, x: number): [number, number, number] => [
    axis === 0 ? x : value[0],
    axis === 1 ? x : value[1],
    axis === 2 ? x : value[2],
  ];

  return (
    <div
      className={cn('grid items-center gap-1 text-[11px] text-slate-400', className)}
      style={{ gridTemplateColumns: `${label != null ? `${labelWidth}px ` : ''}repeat(3, minmax(0, 1fr))` }}
    >
      {label != null && <span className="truncate">{label}</span>}
      {AXES.map((ax) => (
        <NumberInput
          key={ax}
          value={value[ax]}
          step={step}
          min={min}
          max={max}
          precision={precision}
          unit={unit}
          tooltip={tooltips?.[ax]}
          disabled={disabled}
          onChange={(x) => onChange(setAxis(ax, x))}
        />
      ))}
    </div>
  );
}
