import { ClearButton, fieldCls, Labelled, type LabelledProps } from '../fieldChrome';

export interface TextAreaProps extends LabelledProps {
  /** The text. */
  value: string;
  /** Receives the text on every keystroke. */
  onChange: (value: string) => void;
  /** Fires on blur — for commit-style handling on top of onChange. */
  onCommit?: (value: string) => void;
  /** Dimmed text while empty. */
  placeholder?: string;
  /** Visible rows (default 3). */
  rows?: number;
  /** Character limit (native maxLength). */
  maxLength?: number;
  /** Browser spell-check (default false). */
  spellCheck?: boolean;
  /** Allow the user to resize vertically (default true). */
  resizable?: boolean;
  /** Lower bound for the field height in px — also the floor while resizing. */
  minHeight?: number;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
  /** Show the in-field clear (✕) button (default true). */
  clearable?: boolean;
  /** What ✕ does. Default clears the content; provide this to override. */
  onClear?: () => void;
}

/** Multi-line text field in the studio look; label on top, to the left, or split (see LabelledProps). */
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
  tooltip,
  shortcut,
  clearable = true,
  onClear,
  disabled = false,
  ...labelled
}: TextAreaProps) {
  const showClear = clearable && !disabled && (onClear != null || value.length > 0);

  return (
    <Labelled {...labelled} disabled={disabled} multiline>
      <div className="relative" data-tooltip={tooltip} data-shortcut={shortcut}>
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
