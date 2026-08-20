import type { ReactNode } from 'react';
import { NumberInput, type NumberInputProps } from '../number/NumberInput';
import { RibbonSlot } from './RibbonSlot';
import type { RibbonSize } from './ribbonSizes';

export interface RibbonNumberProps extends Omit<NumberInputProps, 'className'> {
  /** Caption in the label column, left of the field. */
  label?: ReactNode;
  /** Width of the input field in px (default 116 — fits “1000.00 m” plus steppers). */
  fieldWidth?: number;
  /**
   * Width of the label column in px (default 34). Stacked RibbonNumbers share
   * it, so their inputs line up; widen it when your labels are longer.
   */
  labelWidth?: number;
  size?: RibbonSize;
  className?: string;
}

/** A NumberInput in a ribbon slot — onChange fires on step, wheel, drag, and commit (Enter/blur). */
export function RibbonNumber({
  label,
  labelWidth = 34,
  fieldWidth = 116,
  size = 'medium',
  className = '',
  ...input
}: RibbonNumberProps) {
  return (
    <RibbonSlot size={size} className={className}>
      <div
        className="grid h-full w-full items-center gap-x-1.5"
        style={{ gridTemplateColumns: label != null ? `${labelWidth}px ${fieldWidth}px` : `${fieldWidth}px` }}
      >
        {label != null && <span className="truncate text-slate-400 text-xs leading-4">{label}</span>}
        <NumberInput {...input} className={`w-full min-w-0 ${size === 'mini' ? 'h-full' : ''}`} />
      </div>
    </RibbonSlot>
  );
}
