import { IconCheck, IconCopy } from '@tabler/icons-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import type { ButtonSize } from './buttonStyles';

export interface CopyButtonProps {
  /** The text put on the clipboard — a string, or a getter for something
   *  expensive to build (a whole grid as TSV). */
  value: string | (() => string);
  /** Label while idle (default "Copy"); omit with `iconOnly`. */
  children?: ReactNode;
  /** Label while the confirmation shows (default "Copied"). */
  copiedLabel?: string;
  size?: ButtonSize;
  iconOnly?: boolean;
  disabled?: boolean;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
  className?: string;
}

const CONFIRM_MS = 1200;

/** Copy-to-clipboard with its own "Copied" confirmation — so no panel has to
 *  hand-roll the timer, and a failed copy simply never confirms. */
export function CopyButton({
  value,
  children = 'Copy',
  copiedLabel = 'Copied',
  size = 'md',
  iconOnly = false,
  disabled = false,
  tooltip,
  shortcut,
  className = '',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current != null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const handleClick = () => {
    const text = typeof value === 'function' ? value() : value;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (timer.current != null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
    });
  };

  return (
    <Button
      size={size}
      iconOnly={iconOnly}
      disabled={disabled}
      tooltip={tooltip}
      shortcut={shortcut}
      className={className}
      icon={copied ? <IconCheck /> : <IconCopy />}
      onClick={handleClick}
    >
      {iconOnly ? undefined : copied ? copiedLabel : children}
    </Button>
  );
}
