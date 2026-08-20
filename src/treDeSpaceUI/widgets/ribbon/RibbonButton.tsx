import type { CSSProperties, ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { RIBBON_HEIGHT, type RibbonSize } from './ribbonSizes';

export interface RibbonButtonProps {
  /** Pass a Tabler/Heroicons element — it is locked to 18×18 regardless of size. Omit for text-only buttons. */
  icon?: ReactNode;
  label?: ReactNode;
  /** big = 1 per column, medium = 2 stacked, mini = 3 stacked. */
  size?: RibbonSize;
  selected?: boolean;
  /** Optional icon/label colour override while selected (default: theme blue). */
  selectedColor?: string;
  /** Fixed background — for swatch-style buttons; hover brightens it. */
  background?: string;
  /** Small counter/annotation shown above a big button. */
  badge?: ReactNode;
  disabled?: boolean;
  title?: string;
  /** Styled tooltip (data-tooltip); supports "\n" for multiple lines. */
  tooltip?: string;
  /** Hotkey id (see hotkeys/bindings.ts). Renders data-shortcut; the tooltip
   *  gets a footer line showing the current combo. */
  shortcut?: string;
  onClick?: () => void;
  /** Raw pointer-down — used to start a drag (e.g. dragging a panel out of the
   *  Panels ribbon into the dock). */
  onPointerDown?: (e: ReactPointerEvent) => void;
  className?: string;
}

/** The ribbon's button: big icon-over-label, or medium/mini stacked rows. */
export function RibbonButton({
  icon,
  label,
  size = 'big',
  selected = false,
  selectedColor,
  background,
  badge,
  disabled = false,
  title,
  tooltip,
  shortcut,
  onClick,
  onPointerDown,
  className = '',
}: RibbonButtonProps) {
  const style: CSSProperties = {
    ...(selected && !background && selectedColor ? { color: selectedColor } : null),
    ...(background ? { background } : null),
  };

  const shape =
    size === 'big'
      ? `${RIBBON_HEIGHT.big} min-w-16 flex-col justify-center gap-1 px-1.5 text-xs`
      : size === 'medium'
        ? `${RIBBON_HEIGHT.medium} flex-row justify-start gap-1.5 px-2 text-xs`
        : `${RIBBON_HEIGHT.mini} flex-row justify-start gap-1.5 px-2 text-xs`;

  // background-only button (no icon/label) = a palette swatch: a perfect
  // square sized by the row height, centred in its column
  const swatch = !!background && icon == null && label == null;

  const skin = background
    ? 'border-black/30 text-white hover:brightness-125'
    : selected
      ? 'border-blue-400 bg-blue-950 text-blue-100 hover:border-blue-300'
      : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600 hover:bg-slate-800 hover:text-slate-100';

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      data-tooltip={tooltip}
      data-shortcut={shortcut}
      style={style}
      className={`relative flex shrink-0 cursor-pointer items-center border leading-none transition-colors duration-75 active:translate-y-px ${swatch ? 'aspect-square self-center px-0' : 'w-full'} ${shape} ${skin} ${
        disabled ? 'cursor-not-allowed opacity-40' : ''
      } ${className}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      {badge != null && <span className="absolute top-0.5 right-1 text-slate-400 text-xs">{badge}</span>}
      {icon ? (
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]">
          {icon}
        </span>
      ) : null}
      {label != null && <span className="truncate leading-4">{label}</span>}
    </button>
  );
}
