import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

/** A key-cap chip for a shortcut combo — the read-only sibling of a Button,
 *  sized for a property row rather than a toolbar. */
export function Kbd({ children, className = '' }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex shrink-0 items-center border border-slate-700 bg-slate-800 px-1.5 py-px font-mono text-[10px] text-slate-300 leading-4',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
