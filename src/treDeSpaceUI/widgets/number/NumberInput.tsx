import { cn } from '../../lib/cn';
import { Labelled, type LabelledProps } from '../fieldChrome';
import { useNumberInputControl } from './useNumberInputControl';

export interface NumberInputProps extends LabelledProps {
  /** Current value; shown rounded to `precision`. */
  value: number;
  /** Receives every change, clamped to [min, max] and rounded to `precision`. */
  onChange: (value: number) => void;
  /** Lower bound (default: none). */
  min?: number;
  /** Upper bound (default: none). */
  max?: number;
  /** Increment of − / +, ↑ / ↓, a wheel notch and each 4 px of drag (default 1). */
  step?: number;
  /** Decimals shown/kept; derived from step when omitted. */
  precision?: number;
  /** Suffix rendered after the value, e.g. "px", "×" — hidden while typing. */
  unit?: string;
  /** Styled tooltip (data-tooltip) for the field as a whole. */
  tooltip?: string;
  /** Hotkey id (data-shortcut) for the field — the tooltip gets a combo footer. */
  shortcut?: string;
  /** Hotkey id for the − stepper (data-shortcut — its tooltip shows the combo). */
  decShortcut?: string;
  /** Hotkey id for the + stepper (data-shortcut — its tooltip shows the combo). */
  incShortcut?: string;
}

const STEPPER_CLS =
  'flex w-6 shrink-0 cursor-pointer items-center justify-center border-0 bg-slate-800 text-sm leading-none text-slate-300 hover:bg-slate-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * A stepper in the studio look: − and + on either side, and a "rolling"
 * middle — scroll the wheel over it, or press and drag horizontally like a
 * Blender field. A plain click still focuses it for typing: Enter or blur
 * commits, Escape reverts, ↑ / ↓ step.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  precision,
  unit,
  tooltip,
  shortcut,
  decShortcut,
  incShortcut,
  disabled = false,
  className = '',
  ...labelled
}: NumberInputProps) {
  const decimals = precision ?? Math.max(0, -Math.floor(Math.log10(step)));
  const c = useNumberInputControl(value, onChange, step, decimals, min, max, disabled);

  // `className` sizes the ROW (see Labelled). The field fills it, taking the
  // default height unless the caller gave the row one (`h-full` in a ribbon slot).
  const heightCls = /(^|\s)h-/.test(className) ? 'h-full' : 'h-6';

  return (
    <Labelled {...labelled} disabled={disabled} className={className}>
      <div
        data-tooltip={tooltip}
        data-shortcut={shortcut}
        className={cn(
          'flex items-stretch overflow-hidden border border-slate-700 bg-slate-900 text-slate-200 text-xs focus-within:border-blue-400',
          heightCls,
          disabled && 'opacity-50',
        )}
      >
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          data-shortcut={decShortcut}
          className={STEPPER_CLS}
          onClick={() => c.bump(-1)}
        >
          −
        </button>
        <input
          ref={c.inputRef}
          value={c.text ?? `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`}
          disabled={disabled}
          inputMode="decimal"
          className={cn(
            'w-full min-w-0 flex-1 border-0 bg-transparent text-center text-inherit text-xs outline-none',
            c.text == null && 'cursor-ew-resize select-none',
          )}
          onChange={(e) => c.setText(e.target.value)}
          onFocus={() => {
            if (!c.isDragging()) {
              c.setText(value.toFixed(decimals));
            }
          }}
          onBlur={c.commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              c.inputRef.current?.blur();
            } else if (e.key === 'Escape') {
              c.setText(null);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              c.bump(1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              c.bump(-1);
            }
          }}
          onPointerDown={c.onPointerDown}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          data-shortcut={incShortcut}
          className={STEPPER_CLS}
          onClick={() => c.bump(1)}
        >
          +
        </button>
      </div>
    </Labelled>
  );
}
