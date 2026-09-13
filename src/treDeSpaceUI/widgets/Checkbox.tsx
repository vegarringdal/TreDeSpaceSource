import { type ReactNode, useCallback } from 'react';
import { cn } from '../lib/cn';
import { InfoButton } from './InfoButton';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Label after the box — the whole label toggles. */
  label?: ReactNode;
  /** Small dimmed note after the label. */
  hint?: string;
  /** Longer explanation, shown behind an info icon after the label (replaces
   *  the inline hint when set) — keeps the row short. */
  info?: ReactNode;
  /** Neither on nor off: some of what this box covers is checked. Purely
   *  visual — `checked` still decides what a click reports. */
  indeterminate?: boolean;
  disabled?: boolean;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
  className?: string;
}

/** A single on/off checkbox in the settings-panel visual language — the
 *  standalone sibling of a RadioGroup row. */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  info,
  indeterminate = false,
  disabled = false,
  tooltip,
  shortcut,
  className = '',
}: CheckboxProps) {
  // `indeterminate` is a DOM property with no attribute, so it has to be set
  // on the element itself.
  const setTriState = useCallback(
    (el: HTMLInputElement | null) => {
      if (el != null) {
        el.indeterminate = indeterminate;
      }
    },
    [indeterminate],
  );

  return (
    // the info icon is a sibling of the <label>, not inside it, so clicking
    // it can't toggle the box
    <div className={cn('flex items-center gap-2', className)}>
      <label
        className={cn('flex items-center gap-2 text-slate-300 text-xs', disabled ? 'opacity-50' : 'cursor-pointer')}
        data-tooltip={tooltip}
        data-shortcut={shortcut}
      >
        <input
          ref={setTriState}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
        {info == null && hint && <span className="text-slate-500">— {hint}</span>}
      </label>
      {info != null && <InfoButton>{info}</InfoButton>}
    </div>
  );
}
