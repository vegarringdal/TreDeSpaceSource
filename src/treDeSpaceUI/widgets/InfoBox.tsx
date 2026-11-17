import { IconAlertTriangle, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { TONE_ACCENT, TONE_BLOCK, type Tone } from './tone';

export interface InfoBoxProps {
  children: ReactNode;
  /** Semantic colour — `warning` (the default) is the hint/caution note,
   *  `danger` a failure the user must act on. */
  tone?: Tone;
  /** Replaces the tone's default icon; null drops the icon entirely. */
  icon?: ReactNode | null;
  className?: string;
}

const DEFAULT_ICON: Readonly<Record<Tone, ReactNode>> = {
  neutral: <IconInfoCircle size={15} />,
  info: <IconInfoCircle size={15} />,
  success: <IconCircleCheck size={15} />,
  warning: <IconInfoCircle size={15} />,
  danger: <IconAlertTriangle size={15} />,
};

/** A padded, tinted note — for hints, warnings and inline failures. */
export function InfoBox({ children, tone = 'warning', icon, className = '' }: InfoBoxProps) {
  const glyph = icon === undefined ? DEFAULT_ICON[tone] : icon;
  return (
    <div
      className={cn(
        'flex items-start gap-2 border px-2 py-1.5 text-[11px] text-slate-300 leading-relaxed',
        TONE_BLOCK[tone],
        className,
      )}
    >
      {glyph != null && <span className={cn('mt-px shrink-0', TONE_ACCENT[tone])}>{glyph}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
