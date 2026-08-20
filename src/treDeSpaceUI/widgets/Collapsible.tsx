import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import { cn } from '../lib/cn';
import { InfoButton } from './InfoButton';

export interface CollapsibleProps {
  title: ReactNode;
  /** Optional right-aligned note in the header (count, badge…). */
  aside?: ReactNode;
  /** Explanation shown behind an info icon in the header — the compact
   *  replacement for an always-visible InfoBox inside the section. */
  info?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  /** Fill the remaining panel height while open; the BODY scrolls, not the panel. */
  fill?: boolean;
  /** Height floor for a `fill` section (Tailwind class, e.g. "min-h-64").
   *  Without it a filled section shrinks to nothing when several of them share
   *  a panel; with it the section stops shrinking and the PANEL scrolls. */
  fillMinClass?: string;
}

/** A titled section that collapses. Same header look as the Shortcuts panel
 *  groups; used to organise long settings tabs. */
export function Collapsible({
  title,
  aside,
  info,
  defaultOpen = true,
  children,
  className = '',
  fill = false,
  fillMinClass,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const fillClasses = cn('min-h-0 flex-1 overflow-hidden', fillMinClass);
  return (
    <div className={cn('flex flex-col border border-slate-800', fill && open && fillClasses, className)}>
      {/* a row, not a single <button>, so the info popover trigger isn't a
          nested button inside the toggle */}
      <div className="flex w-full items-center gap-1 bg-slate-800 px-2 py-1 text-slate-200 text-xs hover:bg-slate-700">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left font-medium"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? (
            <IconChevronDown size={14} className="shrink-0" />
          ) : (
            <IconChevronRight size={14} className="shrink-0" />
          )}
          {title}
        </button>
        {aside != null && <span className="text-slate-500">{aside}</span>}
        {info != null && <InfoButton>{info}</InfoButton>}
      </div>
      {open && <div className={cn('flex flex-col gap-2 p-2', fill && fillClasses)}>{children}</div>}
    </div>
  );
}
