import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import {
  BUTTON_ACTIVE,
  BUTTON_BASE,
  BUTTON_ICON_SIZE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  type ButtonSize,
} from './buttonStyles';

export interface SegmentedOption<T extends string = string> {
  value: T;
  /** Omit for an icon-only segment. */
  label?: ReactNode;
  /** Leading icon (locked to 14×14). */
  icon?: ReactNode;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Height/padding scale — matches {@link Button}. */
  size?: ButtonSize;
  /** Split the row evenly between the segments instead of hugging the labels. */
  grow?: boolean;
  /** Fill the parent's height exactly (a ribbon slot) instead of the size's
   *  fixed height. */
  fill?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * A run of joined buttons for one exclusive choice — the horizontal sibling of
 * RadioGroup, for a mode switch that belongs in a toolbar rather than a form.
 * Segments share their borders, so the group reads as one control.
 */
export function SegmentedControl<T extends string = string>({
  value,
  options,
  onChange,
  size = 'md',
  grow = false,
  fill = false,
  disabled = false,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div role="group" className={cn('inline-flex min-w-0 items-stretch', grow && 'flex w-full', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        const iconOnly = o.label == null;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={disabled || o.disabled}
            data-tooltip={o.tooltip}
            data-shortcut={o.shortcut}
            className={cn(
              BUTTON_BASE,
              iconOnly ? BUTTON_ICON_SIZE[size] : BUTTON_SIZE[size],
              fill && 'h-full min-h-0',
              grow && 'min-w-0 flex-1',
              // the shared edge: every segment but the first pulls onto its
              // neighbour's border, and the active one lifts above both
              i > 0 && '-ml-px',
              on ? cn(BUTTON_ACTIVE, 'z-10') : BUTTON_VARIANT.default,
              'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
            )}
            onClick={() => onChange(o.value)}
          >
            {o.icon != null && (
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
                {o.icon}
              </span>
            )}
            {o.label != null && <span className="truncate">{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
