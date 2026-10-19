import type { ReactNode } from 'react';
import { NumberInput } from '../number/NumberInput';
import { Vec3Input } from '../Vec3Input';

/** x y z w */
export type Quaternion = [number, number, number, number];

export interface RotationInputProps {
  /** The rotation as a quaternion [x, y, z, w] (need not be normalised). */
  value: Quaternion;
  /** Receives a unit quaternion. */
  onChange: (q: Quaternion) => void;
  /** euler = X/Y/Z degrees, rotate X, then Y, then Z (default); axisAngle =
   *  an axis and degrees about it. */
  mode?: 'euler' | 'axisAngle';
  /** Row caption in a fixed column before the fields. */
  label?: ReactNode;
  /** Label column width in px (default 48) — share one value down a form. */
  labelWidth?: number;
  /** Stepper step in degrees (default 5). */
  step?: number;
  /** Grey out every field. */
  disabled?: boolean;
  /** Extra classes on the outer element. */
  className?: string;
}

const DEG = Math.PI / 180;

function axisAngle(axis: readonly number[], deg: number): Quaternion {
  const l = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin((deg * DEG) / 2) / l;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos((deg * DEG) / 2)];
}

function mul(a: Quaternion, b: Quaternion): Quaternion {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Quaternion ↔ XYZ Euler degrees (R = Rz·Ry·Rx). */
export function quatToEuler(q: Quaternion): [number, number, number] {
  const l = Math.hypot(...q) || 1;
  const [x, y, z, w] = q.map((v) => v / l);
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);
  const round = (v: number) => Math.round((v / DEG) * 1000) / 1000;
  return [
    round(Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))),
    round(pitch),
    round(Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))),
  ];
}

/** XYZ Euler degrees → quaternion [x, y, z, w] (R = Rz·Ry·Rx — the inverse of quatToEuler). */
export function eulerToQuat(e: readonly number[]): Quaternion {
  return mul(axisAngle([0, 0, 1], e[2]), mul(axisAngle([0, 1, 0], e[1]), axisAngle([1, 0, 0], e[0])));
}

/** Quaternion → unit axis + degrees (0..180; identity reads as +Z, 0°). */
export function quatToAxisAngle(q: Quaternion): { axis: [number, number, number]; degrees: number } {
  const l = Math.hypot(...q) || 1;
  const w = Math.min(1, Math.max(-1, q[3] / l));
  const s = Math.sqrt(1 - w * w);
  if (s < 1e-6) {
    return { axis: [0, 0, 1], degrees: 0 };
  }
  const sign = w < 0 ? -1 : 1;
  return {
    axis: [(sign * q[0]) / l / s, (sign * q[1]) / l / s, (sign * q[2]) / l / s],
    degrees: (2 * Math.acos(Math.abs(w))) / DEG,
  };
}

/**
 * A rotation editor over a quaternion value: three Euler-degree steppers, or
 * an axis + an angle. Storage stays a quaternion; the fields are a view.
 */
export function RotationInput({
  value,
  onChange,
  mode = 'euler',
  label,
  labelWidth = 48,
  step = 5,
  disabled = false,
  className = '',
}: RotationInputProps) {
  if (mode === 'axisAngle') {
    const aa = quatToAxisAngle(value);
    return (
      <div className={className}>
        <Vec3Input
          label={label}
          labelWidth={labelWidth}
          value={aa.axis}
          step={0.1}
          precision={3}
          disabled={disabled}
          tooltips={['Axis X', 'Axis Y', 'Axis Z']}
          onChange={(axis) => onChange(axisAngle(axis, aa.degrees))}
        />
        <NumberInput
          className="mt-1"
          label="Angle"
          labelPosition="left"
          labelWidth={labelWidth}
          value={aa.degrees}
          step={step}
          unit="°"
          disabled={disabled}
          onChange={(deg) => onChange(axisAngle(aa.axis, deg))}
        />
      </div>
    );
  }
  return (
    <Vec3Input
      className={className}
      label={label}
      labelWidth={labelWidth}
      value={quatToEuler(value)}
      step={step}
      unit="°"
      disabled={disabled}
      tooltips={['Rotate about X (°)', 'Rotate about Y (°)', 'Rotate about Z (°)']}
      onChange={(e) => onChange(eulerToQuat(e))}
    />
  );
}
