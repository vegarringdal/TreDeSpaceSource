import { type ReactNode, useId } from 'react';
import { InfoButton } from './InfoButton';

export interface RadioOption {
  value: string;
  label: string;
  /** Small dimmed note after the label. */
  hint?: string;
  /** Longer explanation, shown behind an info icon after the label (replaces
   *  the inline hint when set) — keeps the row short. */
  info?: ReactNode;
  /** Hotkey id (data-shortcut) for this option. */
  shortcut?: string;
}

export interface RadioGroupProps {
  value: string;
  options: RadioOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/** Mutually-exclusive options as native radio buttons — the round indicator
 *  people expect for an exclusive choice, next to the square settings
 *  checkboxes. The options share one generated `name`, so the keyboard
 *  behaves like a real radio group (arrows move within it, Tab lands on the
 *  checked one). Each option carries a data-shortcut so it can be bound to a
 *  hotkey. */
export function RadioGroup({ value, options, onChange, disabled = false, className = '' }: RadioGroupProps) {
  const name = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {options.map((o) => (
        // the info icon is a sibling of the <label>, not inside it, so clicking
        // it can't toggle the option
        <div key={o.value} className="flex items-center gap-2">
          <label
            className={`flex items-center gap-2 text-slate-300 text-xs ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
            data-shortcut={o.shortcut}
          >
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            {o.label}
            {o.info == null && o.hint && <span className="text-slate-500">— {o.hint}</span>}
          </label>
          {o.info != null && <InfoButton>{o.info}</InfoButton>}
        </div>
      ))}
    </div>
  );
}
