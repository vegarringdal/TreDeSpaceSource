import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pickerPopCls, pickerTriggerCls } from './fieldChrome';
import type { PopoverAnchor } from './usePopoverAnchor';

// The trigger button and body-portaled popover shell shared by the picker
// fields (DatePicker, TimePicker) — same chrome, same anchor behavior.

export interface PickerFieldProps {
  open: boolean;
  /** Leading field icon (locked to 14×14 by the caller). */
  icon: ReactNode;
  /** Current display text, or null to show the placeholder. */
  value: string | null;
  placeholder: string;
  /** aria-label of the hover-revealed clear ×. */
  clearLabel: string;
  disabled: boolean;
  /** Styled tooltip (data-tooltip). */
  tooltip?: string;
  /** Hotkey id (data-shortcut) — the tooltip gets a combo footer. */
  shortcut?: string;
  onToggle: () => void;
  onClear: () => void;
}

/** Select-style trigger: icon + value text + hover-revealed clear ×. */
export function PickerField({
  open,
  icon,
  value,
  placeholder,
  clearLabel,
  disabled,
  tooltip,
  shortcut,
  onToggle,
  onClear,
}: PickerFieldProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-tooltip={tooltip}
      data-shortcut={shortcut}
      className={pickerTriggerCls(open, disabled)}
      onClick={onToggle}
    >
      {icon}
      {value != null ? (
        <span className="min-w-0 flex-1 truncate">{value}</span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-slate-400">{placeholder}</span>
      )}
      {value != null && !disabled && (
        <span
          role="button"
          aria-label={clearLabel}
          title="Clear"
          className="shrink-0 cursor-pointer px-0.5 text-slate-400 leading-none opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          ×
        </span>
      )}
    </button>
  );
}

export interface PickerPopoverProps {
  anchor: PopoverAnchor;
  /** Popover width in px — used to clamp the left edge into the viewport. */
  width: number;
  children: ReactNode;
}

/** Body-portaled popover box anchored under (or above) the trigger. */
export function PickerPopover({ anchor, width, children }: PickerPopoverProps) {
  return createPortal(
    <div
      ref={anchor.popRef}
      className={pickerPopCls}
      style={{
        left: Math.max(4, Math.min(anchor.pos.left, window.innerWidth - width - 4)),
        top: anchor.pos.up ? undefined : anchor.pos.top + 4,
        bottom: anchor.pos.up ? window.innerHeight - anchor.pos.top + 4 : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
