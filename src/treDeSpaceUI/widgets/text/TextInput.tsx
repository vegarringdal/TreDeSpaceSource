import { ClearButton, fieldCls, Labelled, type LabelledProps } from '../fieldChrome';

export interface TextInputProps extends LabelledProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires on Enter and blur — for commit-style handling on top of onChange. */
  onCommit?: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'email' | 'url' | 'search';
  maxLength?: number;
  spellCheck?: boolean;
  /** Show the in-field clear (✕) button (default true). */
  clearable?: boolean;
  /** What ✕ does. Default clears the content; provide this to override (e.g.
   *  reset-to-default). When given, the button shows even when empty. */
  onClear?: () => void;
}

/** Single-line text field in the studio look, label on top or to the left. */
export function TextInput({
  value,
  onChange,
  onCommit,
  placeholder,
  type = 'text',
  maxLength,
  spellCheck = false,
  clearable = true,
  onClear,
  disabled = false,
  ...labelled
}: TextInputProps) {
  const showClear = clearable && !disabled && (onClear != null || value.length > 0);

  return (
    <Labelled {...labelled} disabled={disabled}>
      <div className="relative">
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          spellCheck={spellCheck}
          disabled={disabled}
          className={`${fieldCls} h-6 py-0 ${showClear ? 'pr-6' : ''}`}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onCommit?.((e.target as HTMLInputElement).value);
            }
          }}
        />
        {showClear && (
          <ClearButton
            className="top-1/2 right-0.5 -translate-y-1/2"
            onClick={() => (onClear ? onClear() : onChange(''))}
          />
        )}
      </div>
    </Labelled>
  );
}
