import { type ReactNode, useState } from 'react';
import { cn } from '../lib/cn';

export interface InlinePanelProps {
  title: ReactNode;
  /** Uncontrolled initial state. */
  defaultOpen?: boolean;
  /** Controlled state — pair with onToggle. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** Extra controls rendered at the right end of the header. */
  actions?: ReactNode;
  /** The header text is UPPERCASED by default (the dock-panel look); set
   *  false to show the title exactly as written. */
  titleUppercase?: boolean;
  /** Classes for the header text — merged over the default styling, so
   *  `titleClassName="text-sm normal-case text-sky-300"` restyles it without
   *  replacing the widget. Pass a node as `title` for full control. */
  titleClassName?: string;
  children: ReactNode;
  className?: string;
}

/**
 * A collapsible section for stacking inside panels — the inline cousin of a
 * dock panel. The body animates shut via the grid-rows trick, so no measuring.
 */
export function InlinePanel({
  title,
  defaultOpen = true,
  open,
  onToggle,
  actions,
  titleUppercase = true,
  titleClassName,
  children,
  className = '',
}: InlinePanelProps) {
  const [own, setOwn] = useState(defaultOpen);
  const isOpen = open ?? own;
  const toggle = () => {
    onToggle?.(!isOpen);
    if (open == null) {
      setOwn(!isOpen);
    }
  };

  return (
    <section className={`overflow-hidden border border-slate-800 bg-slate-900 ${className}`}>
      <header className="flex select-none items-center gap-1.5 bg-slate-800/60 px-2 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left font-semibold text-slate-200"
          aria-expanded={isOpen}
          onClick={toggle}
        >
          <svg
            viewBox="0 0 8 8"
            className={`h-2 w-2 shrink-0 fill-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          >
            <path d="M2 0l4 4-4 4z" />
          </svg>
          <span
            className={cn(
              'truncate font-medium text-xs leading-4 tracking-wide',
              titleUppercase && 'uppercase',
              titleClassName,
            )}
          >
            {title}
          </span>
        </button>
        {actions && <span className="flex shrink-0 items-center gap-1">{actions}</span>}
      </header>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-2.5 py-2">{children}</div>
        </div>
      </div>
    </section>
  );
}
