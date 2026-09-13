import { cn } from '../lib/cn';

export interface SwatchProps {
  /** Any CSS colour — rendered as-is, never converted (display values only). */
  color: string;
  onClick?: () => void;
  /** Ring the swatch as the current pick. */
  active?: boolean;
  /** Edge length in px (default 16). */
  size?: number;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
  disabled?: boolean;
  className?: string;
}

/** A single colour chip — click-to-apply in a palette row, or a static
 *  read-out of a rule's colour when no `onClick` is given. */
export function Swatch({
  color,
  onClick,
  active = false,
  size = 16,
  tooltip,
  shortcut,
  disabled = false,
  className = '',
}: SwatchProps) {
  const box = cn(
    'inline-block shrink-0 border border-black/40',
    active && 'outline outline-2 outline-slate-100 outline-offset-[-3px]',
    className,
  );
  const style = { width: size, height: size, background: color };

  if (onClick == null) {
    return <span data-tooltip={tooltip} className={box} style={style} />;
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={tooltip ?? color}
      data-tooltip={tooltip}
      data-shortcut={shortcut}
      className={cn(box, 'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40')}
      style={style}
      onClick={onClick}
    />
  );
}
