import { IconX } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/** The in-field clear button (shared by TextInput/TextArea). Floats over the
 *  right edge; clears content by default, or runs `onClear` when given. */
export function ClearButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-tooltip="Clear"
      className={`absolute flex h-5 w-5 items-center justify-center text-slate-500 hover:text-slate-200 ${className}`}
      onClick={onClick}
    >
      <IconX size={13} />
    </button>
  );
}

export interface LabelledProps {
  label?: ReactNode;
  /**
   * Where the label sits relative to the field. `left` gives the LABEL a fixed
   * column (`labelWidth`) and lets the field fill — stacked form fields line
   * up. `split` is the settings-row inverse: the label takes the free space
   * and the FIELD keeps a fixed width (`fieldWidth`).
   */
  labelPosition?: 'top' | 'left' | 'split';
  /** Label column width in px for `left` — share one value across stacked fields so they align. */
  labelWidth?: number;
  /** Field column width in px for `split` (default 112). */
  fieldWidth?: number;
  disabled?: boolean;
  className?: string;
}

export const fieldCls =
  'w-full min-w-0 border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none transition-colors hover:border-slate-600 focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-50';

/** Select-style popover trigger chrome shared by the picker fields. */
export function pickerTriggerCls(open: boolean, disabled: boolean): string {
  return `group flex h-6 w-full cursor-pointer items-center gap-1.5 border px-2 text-left text-slate-200 text-xs outline-none focus-visible:border-blue-400 ${
    open ? 'border-blue-400 bg-slate-900' : 'border-slate-700 bg-slate-900 hover:border-slate-600'
  } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`;
}

/** Body-portaled popover container shared by the picker fields (matches the
 *  Select list's box). */
export const pickerPopCls =
  'fixed z-[1000] border border-slate-700 bg-slate-900 text-slate-200 text-xs shadow-black/40 shadow-lg';

const DEFAULT_FIELD_WIDTH = 112;

/** Optional label wrapper shared by every field widget — the single place a
 *  labelled row is laid out, so Select, NumberInput, ColorSelect and the text
 *  fields all align in the same form. */
export function Labelled({
  label,
  labelPosition = 'top',
  labelWidth = 60,
  fieldWidth = DEFAULT_FIELD_WIDTH,
  multiline = false,
  className = '',
  children,
}: LabelledProps & { multiline?: boolean; children: ReactNode }) {
  if (label == null) {
    return <div className={className}>{children}</div>;
  }

  if (labelPosition === 'split') {
    return (
      <label className={cn('flex w-full min-w-0 items-center justify-between gap-2 text-xs', className)}>
        <span className="min-w-0 truncate text-slate-400">{label}</span>
        <span className="shrink-0" style={{ width: fieldWidth }}>
          {children}
        </span>
      </label>
    );
  }

  if (labelPosition === 'left') {
    return (
      <label
        className={cn('grid w-full min-w-0 gap-x-1.5 text-xs', multiline ? 'items-start' : 'items-center', className)}
        style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}
      >
        <span className={cn('truncate text-slate-400', multiline && 'pt-1.5')}>{label}</span>
        {children}
      </label>
    );
  }

  return (
    <label className={cn('block w-full min-w-0 text-xs', className)}>
      <span className="mb-1 block text-slate-400">{label}</span>
      {children}
    </label>
  );
}
