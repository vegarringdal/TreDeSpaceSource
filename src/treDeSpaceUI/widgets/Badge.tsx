import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { TONE_CHIP, type Tone } from './tone';

export interface BadgeProps {
  children: ReactNode;
  /** Semantic colour — see {@link Tone}. */
  tone?: Tone;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  className?: string;
}

/** A small status chip: a row count, a license name, a "modified" marker.
 *  Square like everything else, sized to sit inside a 22px row without
 *  changing its height. */
export function Badge({ children, tone = 'neutral', tooltip, className = '' }: BadgeProps) {
  return (
    <span
      data-tooltip={tooltip}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 border px-1.5 py-px text-[10px] leading-4',
        TONE_CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
