import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface ButtonProps {
  children?: ReactNode;
  /** Optional leading icon (locked to 14×14). */
  icon?: ReactNode;
  /** The click event is passed so handlers can read modifiers (e.g. Alt). */
  onClick?: (e: ReactMouseEvent) => void;
  disabled?: boolean;
  /** Highlighted / selected look. */
  active?: boolean;
  /** Static display chip — no hover, no pointer, not focusable. Use for
   *  read-only values that share the button look (e.g. a shortcut combo). */
  readOnly?: boolean;
  /** Square icon-only button (h=w), for compact actions like a reset ✕. */
  iconOnly?: boolean;
  title?: string;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
  className?: string;
}

// Square by design — the whole app avoids rounded corners for one visual
// language. Matches the .btn / NumberInput stepper palette.
const BASE = 'inline-flex shrink-0 items-center justify-center gap-1.5 border text-xs leading-none transition-colors';

/** The app's button. Read-only mode renders a non-interactive chip that keeps
 *  the same box so buttons and displayed values line up. */
export function Button({
  children,
  icon,
  onClick,
  disabled = false,
  active = false,
  readOnly = false,
  iconOnly = false,
  title,
  tooltip,
  shortcut,
  className = '',
}: ButtonProps) {
  // Default height matches the inputs (h-6 / 24px) so buttons and fields line
  // up outside the ribbon. In the ribbon, RibbonButton/RibbonNumber size
  // themselves — this widget is for the rest of the app.
  return (
    <button
      type="button"
      disabled={disabled || readOnly}
      tabIndex={readOnly ? -1 : undefined}
      title={title}
      data-tooltip={tooltip}
      data-shortcut={shortcut}
      className={cn(
        BASE,
        iconOnly ? 'h-6 w-6 p-0' : 'h-6 px-2',
        readOnly
          ? 'cursor-default border-slate-700 bg-slate-800 text-slate-300'
          : active
            ? 'cursor-pointer border-blue-400 bg-blue-950 text-blue-100 hover:border-blue-300'
            : 'cursor-pointer border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-600 hover:bg-slate-700 hover:text-slate-100',
        'disabled:cursor-not-allowed',
        !readOnly && 'disabled:opacity-40',
        className,
      )}
      onClick={readOnly ? undefined : onClick}
    >
      {icon != null && (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
