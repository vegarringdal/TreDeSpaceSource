import type { ReactNode } from 'react';
import { Checkbox } from '../Checkbox';
import { ColorSelect } from '../color/ColorSelect';
import { NumberInput } from '../number/NumberInput';
import { SegmentedControl } from '../SegmentedControl';

export interface BorderValue {
  /** Line width in px (the field allows 0–40). */
  width: number;
  /** #rrggbb, or a token / {{key}} reference (then shown as text, not edited). */
  color: string;
  /** Line style. */
  style: 'solid' | 'dashed';
}

export interface BorderInputProps {
  /** null = no border */
  value: BorderValue | null;
  /** Receives the new border, or null when unticked; ticking starts from 1 px solid #94a3b8. */
  onChange: (value: BorderValue | null) => void;
  /** The on/off checkbox's caption (default "Border"). */
  label?: ReactNode;
  /** Grey out every control. */
  disabled?: boolean;
  /** Extra classes on the outer element. */
  className?: string;
}

const STYLES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
] as const;

const DEFAULT: BorderValue = { width: 1, color: '#94a3b8', style: 'solid' };

/** A border: on/off, width, colour, solid or dashed. A colour that is not a
 *  hex (a theme token like "$accent", a "{{value}}" reference) is shown as
 *  text — the caller edits it with its own field. */
export function BorderInput({ value, onChange, label = 'Border', disabled = false, className = '' }: BorderInputProps) {
  const isToken = value !== null && !value.color.startsWith('#');

  return (
    <div className={className}>
      <Checkbox
        label={label}
        checked={value !== null}
        disabled={disabled}
        onChange={(on) => onChange(on ? DEFAULT : null)}
      />
      {value && (
        <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-1">
          <NumberInput
            value={value.width}
            min={0}
            max={40}
            step={1}
            unit="px"
            disabled={disabled}
            tooltip="Border width"
            onChange={(width) => onChange({ ...value, width })}
          />
          <SegmentedControl
            size="sm"
            value={value.style}
            options={STYLES}
            disabled={disabled}
            onChange={(style) => onChange({ ...value, style })}
          />
          {isToken ? (
            <span className="text-[11px] text-slate-400" data-tooltip="Not a plain colour — change it where it is set">
              {value.color}
            </span>
          ) : (
            <ColorSelect
              value={value.color}
              disabled={disabled}
              tooltip="Border colour"
              onChange={(color) => onChange({ ...value, color })}
            />
          )}
        </div>
      )}
    </div>
  );
}
