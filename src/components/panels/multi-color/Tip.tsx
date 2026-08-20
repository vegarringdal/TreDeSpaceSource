import type { ReactNode } from 'react';

/** Select doesn't take a tooltip prop — wrap it so the global data-tooltip
 *  handler picks it up. */
export function Tip({ tip, className, children }: { tip: string; className?: string; children: ReactNode }) {
  return (
    <div data-tooltip={tip} className={className}>
      {children}
    </div>
  );
}
