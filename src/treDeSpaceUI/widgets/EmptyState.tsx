import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps {
  children: ReactNode;
  /** Icon shown above the text — `center` layout only. */
  icon?: ReactNode;
  /** `note` (default) is a dim line in the flow, for "no matches" under a
   *  list; `center` fills the remaining space, for an empty panel body. */
  layout?: 'note' | 'center';
  className?: string;
}

/** The one way a list or panel says it has nothing to show. Replaces the
 *  hand-rolled dim paragraphs so the wording sits in one visual language. */
export function EmptyState({ children, icon, layout = 'note', className = '' }: EmptyStateProps) {
  if (layout === 'center') {
    return (
      <div
        className={cn(
          'flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-slate-500 text-xs',
          className,
        )}
      >
        {icon != null && <span className="text-slate-600">{icon}</span>}
        <span className="max-w-[40ch] leading-relaxed">{children}</span>
      </div>
    );
  }

  return <p className={cn('m-0 mt-3.5 text-slate-400 text-xs', className)}>{children}</p>;
}
