import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface PanelHeaderProps {
  /** Left-hand title — truncates when the panel narrows. */
  title: ReactNode;
  /** Dim notes between the title and the actions (counts, status). */
  aside?: ReactNode;
  /** Buttons / InfoButton at the right end. */
  actions?: ReactNode;
  /**
   * `label` — a dim section caption over a form (the default);
   * `title` — the panel's own name, in full contrast over content;
   * `band` — a tinted strip, for a mode bar that is not the panel title.
   */
  variant?: 'label' | 'title' | 'band';
  className?: string;
}

const SHELL: Readonly<Record<NonNullable<PanelHeaderProps['variant']>, string>> = {
  label: 'border-slate-800 border-b pb-1',
  title: 'border-slate-800 border-b p-1.5',
  band: 'border-slate-700 border-b bg-slate-800/60 px-2 py-1.5',
};

const TITLE: Readonly<Record<NonNullable<PanelHeaderProps['variant']>, string>> = {
  label: 'text-slate-400',
  title: 'font-medium text-slate-200',
  band: 'text-slate-300',
};

/** The fixed top strip of a panel: title, dim asides, actions. Pinned by the
 *  caller (`shrink-0` is built in), so only the content below it scrolls. */
export function PanelHeader({ title, aside, actions, variant = 'label', className = '' }: PanelHeaderProps) {
  return (
    <div className={cn('flex shrink-0 items-center gap-2 text-slate-400 text-xs', SHELL[variant], className)}>
      <span className={cn('min-w-0 flex-1 truncate', TITLE[variant])}>{title}</span>
      {aside}
      {actions}
    </div>
  );
}
