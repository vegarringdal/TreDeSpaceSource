import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Badge } from './Badge';
import {
  BUTTON_ACTIVE,
  BUTTON_BASE,
  BUTTON_ICON_SIZE,
  BUTTON_MIN_H,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  type ButtonSize,
  type ButtonVariant,
} from './buttonStyles';
import { Spinner } from './Spinner';

export interface ButtonProps {
  children?: ReactNode;
  /** Optional leading icon (locked to 14×14). */
  icon?: ReactNode;
  /** The click event is passed so handlers can read modifiers (e.g. Alt). */
  onClick?: (e: ReactMouseEvent) => void;
  disabled?: boolean;
  /** Highlighted / selected look — a state, so it wins over `variant`. */
  active?: boolean;
  /** Emphasis: the confirming action, a destructive one, or borderless. */
  variant?: ButtonVariant;
  /** Height/padding scale — `md` (24px) lines up with the inputs. */
  size?: ButtonSize;
  /** Static display chip — no hover, no pointer, not focusable. Use for
   *  read-only values that share the button look (e.g. a shortcut combo). */
  readOnly?: boolean;
  /** Square icon-only button (h=w), for compact actions like a reset ✕. */
  iconOnly?: boolean;
  /** Let a long label run to a second line instead of overflowing — the
   *  height grows from the size's floor. */
  wrap?: boolean;
  /** Take the free space of a flex row (`flex-1`) instead of hugging the label. */
  grow?: boolean;
  /** Swap the icon for a spinner and block clicks while the action runs. */
  loading?: boolean;
  /** Count / status chip after the label (see {@link Badge}). */
  badge?: ReactNode;
  title?: string;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
  className?: string;
}

/** The app's button. Read-only mode renders a non-interactive chip that keeps
 *  the same box so buttons and displayed values line up. */
export function Button({
  children,
  icon,
  onClick,
  disabled = false,
  active = false,
  variant = 'default',
  size = 'md',
  readOnly = false,
  iconOnly = false,
  wrap = false,
  grow = false,
  loading = false,
  badge,
  title,
  tooltip,
  shortcut,
  className = '',
}: ButtonProps) {
  const leading = loading ? <Spinner size={14} /> : icon;
  const inert = disabled || readOnly || loading;

  // In the ribbon, RibbonButton/RibbonNumber size themselves — this widget is
  // for the rest of the app.
  return (
    <button
      type="button"
      disabled={inert}
      tabIndex={readOnly ? -1 : undefined}
      aria-busy={loading || undefined}
      title={title}
      data-tooltip={tooltip}
      data-shortcut={shortcut}
      className={cn(
        BUTTON_BASE,
        iconOnly ? BUTTON_ICON_SIZE[size] : BUTTON_SIZE[size],
        wrap && !iconOnly && cn('h-auto whitespace-normal py-1 text-center leading-tight', BUTTON_MIN_H[size]),
        grow && 'flex-1',
        readOnly
          ? 'cursor-default border-slate-700 bg-slate-800 text-slate-300'
          : cn('cursor-pointer', active ? BUTTON_ACTIVE : BUTTON_VARIANT[variant]),
        'disabled:cursor-not-allowed',
        !readOnly && 'disabled:opacity-40',
        className,
      )}
      onClick={readOnly ? undefined : onClick}
    >
      {leading != null && (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
          {leading}
        </span>
      )}
      {children}
      {badge != null && <Badge className="ml-0.5">{badge}</Badge>}
    </button>
  );
}
