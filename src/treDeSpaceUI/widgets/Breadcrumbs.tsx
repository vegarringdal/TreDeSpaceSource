import { IconChevronRight } from '@tabler/icons-react';
import { Fragment } from 'react';
import { cn } from '../lib/cn';

export interface BreadcrumbsProps {
  /** Path from the root to the current place; the last one is current. */
  items: readonly { id: string; label: string }[];
  /** A crumb was clicked (never fired for the current one). */
  onSelect: (id: string) => void;
  className?: string;
}

/** A clickable path — Assembly › Step 3 › Motor. The last crumb is where you
 *  are; the others go up. */
export function Breadcrumbs({ items, onSelect, className = '' }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumbs" className={cn('flex min-w-0 items-center gap-0.5 text-[11px]', className)}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={it.id}>
            {i > 0 && <IconChevronRight size={11} className="shrink-0 text-slate-600" />}
            {last ? (
              <span className="min-w-0 truncate text-slate-100" aria-current="page">
                {it.label}
              </span>
            ) : (
              <button
                type="button"
                className="min-w-0 cursor-pointer truncate text-slate-400 hover:text-sky-300"
                onClick={() => onSelect(it.id)}
              >
                {it.label}
              </button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
