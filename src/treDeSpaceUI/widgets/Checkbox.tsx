import type { ReactNode } from 'react';
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
  disabled = false,
  tooltip,
  shortcut,
  className = '',
}: CheckboxProps) {
  return (
    // the info icon is a sibling of the <label>, not inside it, so clicking
    // it can't toggle the box
    <div className={`flex items-center gap-2 ${className}`}>
      <label
        className={`flex items-center gap-2 text-slate-300 text-xs ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
        data-tooltip={tooltip}
        data-shortcut={shortcut}
      >
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {label}
        {info == null && hint && <span className="text-slate-500">— {hint}</span>}
      </label>
      {info != null && <InfoButton>{info}</InfoButton>}
    </div>
  );
}
