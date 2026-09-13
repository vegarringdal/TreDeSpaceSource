import { cn } from '../lib/cn';

export interface SpinnerProps {
  /** Diameter in px (default 14). */
  size?: number;
  /** Accessible label — also the hover tooltip. */
  label?: string;
  className?: string;
}

/** The one indeterminate busy indicator: a spinning arc that inherits the
 *  current text colour, so it works inside a Button as well as on a panel. */
export function Spinner({ size = 14, label = 'Loading', className = '' }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      className={cn('shrink-0 animate-spin fill-none stroke-2 stroke-current', className)}
    >
      <title>{label}</title>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

export interface ProgressBarProps {
  /** 0..1; null/undefined renders an indeterminate sweep. */
  value?: number | null;
  /** Bar height in px (default 6). */
  height?: number;
  className?: string;
}

/** A determinate (or indeterminate) progress bar — the LoadingDialog bar, made
 *  available on its own for inline progress inside a panel. */
export function ProgressBar({ value, height = 6, className = '' }: ProgressBarProps) {
  const pct = value == null ? null : Math.min(100, Math.max(0, value * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct == null ? undefined : Math.round(pct)}
      style={{ height }}
      className={cn('w-full overflow-hidden bg-slate-800', className)}
    >
      {pct == null ? (
        <div className="h-full w-1/3 animate-[tdsSweep_1.1s_ease-in-out_infinite] bg-blue-500" />
      ) : (
        <div className="h-full bg-blue-500 transition-[width] duration-150" style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}
