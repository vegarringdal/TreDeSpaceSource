import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface LinkProps {
  href: string;
  children: ReactNode;
  /** Open in a new tab (default true) — `rel` is set with it. */
  external?: boolean;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  className?: string;
}

/** One look for every out-of-app link. External links (the default) open in a
 *  new tab with `noreferrer`, so a viewer window can never reach back. */
export function Link({ href, children, external = true, tooltip, className = '' }: LinkProps) {
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer noopener' : undefined}
      data-tooltip={tooltip}
      className={cn('cursor-pointer text-blue-400 underline decoration-blue-400/40 hover:text-blue-300', className)}
    >
      {children}
    </a>
  );
}
