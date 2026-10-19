import { IconChevronDown } from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import { cn } from '../../lib/cn';
import {
  BUTTON_ACTIVE,
  BUTTON_BASE,
  BUTTON_ICON_BOX,
  BUTTON_ICON_SIZE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  type ButtonSize,
  type ButtonVariant,
} from '../buttonStyles';
import { Menu, type MenuEntry } from '../menu/Menu';

export interface SplitButtonProps {
  /** The main action's label (an icon may be passed as part of it). */
  label: ReactNode;
  /** Optional leading icon of the main part (locked to 14×14; 20×20 at size lg). */
  icon?: ReactNode;
  /** The main action. */
  onClick: () => void;
  /** The dropdown's entries — the same shape as {@link Menu}. */
  menu: readonly MenuEntry[];
  /** Styled tooltip of the main part. */
  tooltip?: string;
  /** Hotkey id of the main action (tooltip combo footer). */
  shortcut?: string;
  /** Tooltip of the chevron (default "More options"). */
  menuTooltip?: string;
  /** Emphasis of both halves, as on {@link Button} (default 'default'). */
  variant?: ButtonVariant;
  /** Height/padding scale of both halves, as on {@link Button} (default 'md'). */
  size?: ButtonSize;
  /** Highlighted look on the main part (a state, like {@link Button}). */
  active?: boolean;
  /** Disables both halves. */
  disabled?: boolean;
  /** Take the free space of a flex row. */
  grow?: boolean;
  className?: string;
}

/**
 * A button with a default action and a chevron that opens a short menu of
 * alternatives (Play | ▾ Return / Keep my view / Back to my pause view). The
 * two halves share their edge like a SegmentedControl, so they read as one
 * control; the menu opens under the chevron.
 */
export function SplitButton({
  label,
  icon,
  onClick,
  menu,
  tooltip,
  shortcut,
  menuTooltip = 'More options',
  variant = 'default',
  size = 'md',
  active = false,
  disabled = false,
  grow = false,
  className = '',
}: SplitButtonProps) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const tone = active ? BUTTON_ACTIVE : BUTTON_VARIANT[variant];

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAnchor(anchor ? null : { x: r.left, y: r.bottom + 2 });
  };

  return (
    <div role="group" className={cn('inline-flex min-w-0 items-stretch', grow && 'flex flex-1', className)}>
      <button
        type="button"
        disabled={disabled}
        data-tooltip={tooltip}
        data-shortcut={shortcut}
        className={cn(
          BUTTON_BASE,
          BUTTON_SIZE[size],
          tone,
          grow && 'min-w-0 flex-1',
          'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
        )}
        onClick={onClick}
      >
        {icon != null && (
          <span className={cn('flex shrink-0 items-center justify-center', BUTTON_ICON_BOX[size])}>{icon}</span>
        )}
        {label}
      </button>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={disabled}
        data-tooltip={menuTooltip}
        className={cn(
          BUTTON_BASE,
          BUTTON_ICON_SIZE[size],
          BUTTON_VARIANT[variant],
          '-ml-px cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
        )}
        onClick={openMenu}
      >
        <IconChevronDown size={12} />
      </button>
      <Menu anchor={anchor} items={menu} onClose={() => setAnchor(null)} />
    </div>
  );
}
