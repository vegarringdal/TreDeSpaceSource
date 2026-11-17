import { IconLink, IconLinkOff } from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import { Button } from '../Button';
import { NumberInput } from '../number/NumberInput';

export type BoxSides = [number, number, number, number];

export interface BoxSidesInputProps {
  /** top, right, bottom, left (CSS order) */
  value: BoxSides;
  /** Receives all four sides (CSS order). */
  onChange: (value: BoxSides) => void;
  /** Row caption before the linked field. */
  label?: ReactNode;
  /** Label width in px (default 48). */
  labelWidth?: number;
  /** Lower bound per side (default 0). */
  min?: number;
  /** Upper bound per side (default 400). */
  max?: number;
  /** Stepper step (default 1). */
  step?: number;
  /** Suffix on each field (default "px"). */
  unit?: string;
  /** Grey out the fields and the link toggle. */
  disabled?: boolean;
  /** Extra classes on the outer element. */
  className?: string;
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;

/** Four sides of a box (padding, margin): linked = one value for all, or
 *  each side on its own. */
export function BoxSidesInput({
  value,
  onChange,
  label,
  labelWidth = 48,
  min = 0,
  max = 400,
  step = 1,
  unit = 'px',
  disabled = false,
  className = '',
}: BoxSidesInputProps) {
  const [linked, setLinked] = useState(value.every((v) => v === value[0]));

  return (
    <div className={className}>
      <div className="flex items-center gap-1 text-[11px] text-slate-400">
        {label != null && (
          <span className="truncate" style={{ width: labelWidth }}>
            {label}
          </span>
        )}
        {linked ? (
          <NumberInput
            className="min-w-0 flex-1"
            value={value[0]}
            min={min}
            max={max}
            step={step}
            unit={unit}
            disabled={disabled}
            tooltip="All four sides"
            onChange={(v) => onChange([v, v, v, v])}
          />
        ) : (
          <span className="min-w-0 flex-1 text-slate-500">per side</span>
        )}
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          icon={linked ? <IconLink /> : <IconLinkOff />}
          tooltip={linked ? 'Edit each side on its own' : 'One value for all sides'}
          disabled={disabled}
          onClick={() => setLinked((l) => !l)}
        />
      </div>
      {!linked && (
        <div className="mt-1 grid grid-cols-2 gap-1">
          {SIDES.map((s, i) => (
            <NumberInput
              key={s}
              label={s[0]}
              labelPosition="left"
              labelWidth={14}
              value={value[i]}
              min={min}
              max={max}
              step={step}
              unit={unit}
              disabled={disabled}
              tooltip={s}
              onChange={(v) =>
                onChange([
                  i === 0 ? v : value[0],
                  i === 1 ? v : value[1],
                  i === 2 ? v : value[2],
                  i === 3 ? v : value[3],
                ])
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
