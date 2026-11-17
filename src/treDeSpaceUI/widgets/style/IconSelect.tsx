import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface IconSelectProps {
  /** The picked icon's `name`. */
  value: string;
  /** The fixed icon set to choose from; `label` is the tooltip (default: `name`). */
  icons: readonly { name: string; label?: string; node: ReactNode }[];
  /** Receives the clicked icon's `name`. */
  onChange: (value: string) => void;
  /** Grey out every icon. */
  disabled?: boolean;
  /** Extra classes on the wrapping row. */
  className?: string;
}

/** Pick one icon from a fixed set — a compact grid of glyph buttons. */
export function IconSelect({ value, icons, onChange, disabled = false, className = '' }: IconSelectProps) {
  return (
    <div role="radiogroup" className={cn('flex flex-wrap gap-0.5', className)}>
      {icons.map((i) => (
        <button
          key={i.name}
          type="button"
          role="radio"
          aria-checked={i.name === value}
          disabled={disabled}
          data-tooltip={i.label ?? i.name}
          className={cn(
            'flex h-6 w-6 cursor-pointer items-center justify-center border text-slate-300 [&>svg]:h-4 [&>svg]:w-4',
            i.name === value
              ? 'border-blue-400 bg-blue-950 text-blue-100'
              : 'border-slate-700 bg-slate-900 hover:bg-slate-800',
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
          onClick={() => onChange(i.name)}
        >
          {i.node}
        </button>
      ))}
    </div>
  );
}
