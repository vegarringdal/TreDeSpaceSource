import { ClearButton, fieldCls, Labelled, type LabelledProps } from '../fieldChrome';

export interface TextAreaProps extends LabelledProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires on blur — for commit-style handling on top of onChange. */
  onCommit?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  spellCheck?: boolean;
  /** Allow the user to resize vertically (default true). */
  resizable?: boolean;
  /** Lower bound for the field height in px — also the floor while resizing. */
  minHeight?: number;
  /** Show the in-field clear (✕) button (default true). */
  clearable?: boolean;
  /** What ✕ does. Default clears the content; provide this to override. */
  onClear?: () => void;
}

/** Multi-line text field in the studio look, label on top or to the left. */
export function TextArea({
  value,
  onChange,
  onCommit,
  placeholder,
  rows = 3,
  maxLength,
  spellCheck = false,
  resizable = true,
  minHeight,
  clearable = true,
  onClear,
  disabled = false,
  ...labelled
}: TextAreaProps) {
  const showClear = clearable && !disabled && (onClear != null || value.length > 0);

  return (
    <Labelled {...labelled} disabled={disabled} multiline>
      <div className="relative">
        <textarea
          value={value}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          spellCheck={spellCheck}
          disabled={disabled}
          style={minHeight != null ? { minHeight } : undefined}
          className={`${fieldCls} block leading-relaxed ${showClear ? 'pr-6' : ''} ${resizable ? 'resize-y' : 'resize-none'}`}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit?.(e.target.value)}
        />
        {showClear && <ClearButton className="top-1 right-0.5" onClick={() => (onClear ? onClear() : onChange(''))} />}
      </div>
    </Labelled>
  );
}
