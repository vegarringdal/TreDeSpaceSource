import { IconInfoCircle } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export interface InfoBoxProps {
  children: ReactNode;
  className?: string;
}

/** A padded, tinted note with a circled info icon — for hints/explanations. */
export function InfoBox({ children, className = '' }: InfoBoxProps) {
  return (
    <div
      className={`flex items-start gap-2 border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-slate-300 leading-relaxed ${className}`}
    >
      <IconInfoCircle size={15} className="mt-px shrink-0 text-amber-400" />
      <div>{children}</div>
    </div>
  );
}
