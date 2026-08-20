import { cn } from '@treDeSpaceUI/lib/cn';
import { InfoButton } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';

/** A labelled settings checkbox with optional shortcut, tooltip and info popover. */
export function Check({
  label,
  checked,
  onChange,
  shortcut,
  tooltip,
  info,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  shortcut?: string;
  tooltip?: string;
  /** Longer explanation shown behind an info icon after the label. */
  info?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label
        className={cn(
          'flex items-center gap-2 text-xs',
          disabled ? 'cursor-default text-slate-500' : 'cursor-pointer text-slate-300',
        )}
        data-shortcut={shortcut}
        data-tooltip={tooltip}
      >
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {info != null && <InfoButton>{info}</InfoButton>}
    </div>
  );
}
