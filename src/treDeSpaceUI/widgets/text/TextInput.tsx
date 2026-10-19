import { type KeyboardEvent as ReactKeyboardEvent, useCallback } from 'react';
import { cn } from '../../lib/cn';
import { ClearButton, fieldCls, Labelled, type LabelledProps } from '../fieldChrome';

export interface TextInputProps extends LabelledProps {
  /** The text. */
  value: string;
  /** Receives the text on every keystroke. */
  onChange: (value: string) => void;
  /** Fires on Enter and blur — for commit-style handling on top of onChange. */
  onCommit?: (value: string) => void;
  /** Runs before the field's own Enter handling — for Escape, arrows, Tab;
   *  call preventDefault() to skip the Enter commit. */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
  /** Dimmed text while empty. */
  placeholder?: string;
  /** The native input type (default `text`). */
  type?: 'text' | 'password' | 'email' | 'url' | 'search';
  /** Character limit (native maxLength). */
  maxLength?: number;
  /** Browser spell-check (default false). */
  spellCheck?: boolean;
  /** Take focus on mount — for the single field of a dialog. */
  autoFocus?: boolean;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
  /** Show the in-field clear (✕) button (default true). */
  clearable?: boolean;
  /** What ✕ does. Default clears the content; provide this to override (e.g.
   *  reset-to-default). When given, the button shows even when empty. */
  onClear?: () => void;
}

/** Single-line text field in the studio look; label on top, to the left, or split (see LabelledProps). */
export function TextInput({
  value,
  onChange,
  onCommit,
  onKeyDown,
  placeholder,
  type = 'text',
  maxLength,
  spellCheck = false,
  autoFocus = false,
  tooltip,
  shortcut,
  clearable = true,
  onClear,
  disabled = false,
  ...labelled
}: TextInputProps) {
  const showClear = clearable && !disabled && (onClear != null || value.length > 0);

  // A ref callback rather than the autoFocus attribute: it keeps the focus
  // decision out of the markup (and off the a11y lint) and still runs once.
  const focusOnMount = useCallback(
    (el: HTMLInputElement | null) => {
      if (el != null && autoFocus) {
        el.focus();
        el.select();
      }
    },
    [autoFocus],
  );

  return (
    <Labelled {...labelled} disabled={disabled}>
      <div className="relative" data-tooltip={tooltip} data-shortcut={shortcut}>
        <input
          ref={focusOnMount}
          type={type}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          spellCheck={spellCheck}
          disabled={disabled}
          className={cn(fieldCls, 'h-6 py-0', showClear && 'pr-6')}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit?.(e.target.value)}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (!e.defaultPrevented && e.key === 'Enter') {
              onCommit?.(e.currentTarget.value);
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
