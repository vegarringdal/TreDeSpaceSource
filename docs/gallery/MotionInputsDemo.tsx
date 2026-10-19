import { type EasingOption, EasingSelect, type Quaternion, RotationInput, TimeInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

type Ease = 'linear' | 'in' | 'out' | 'inOut';

const EASES: readonly EasingOption<Ease>[] = [
  { value: 'linear', label: 'Linear', curve: (u) => u },
  { value: 'in', label: 'Ease in', curve: (u) => u * u },
  { value: 'out', label: 'Ease out', curve: (u) => 1 - (1 - u) * (1 - u) },
  { value: 'inOut', label: 'Ease in-out', curve: (u) => u * u * (3 - 2 * u) },
];

/** Gallery section for TimeInput, EasingSelect and RotationInput. */
export function MotionInputsDemo() {
  const [t, setT] = useState(12.5);
  const [ease, setEase] = useState<Ease>('inOut');
  const [q, setQ] = useState<Quaternion>([0, 0, 0.3827, 0.9239]);
  return (
    <Section
      title="TimeInput / EasingSelect / RotationInput"
      note="Fields for motion. A time is always seconds, clamped to [min, max] (min defaults to 0), shown as seconds or whole frames on a stepper, or as a typed m:ss.s clock that commits on Enter or blur. An easing is picked from curve glyphs — generic over your easing union, you supply the curves; an option's `shortcut` puts its hotkey in the segment's tooltip. A rotation is stored as a quaternion and edited as X/Y/Z Euler degrees or as an axis + angle; the value it emits is always normalised. parseClock / formatClock and the quaternion conversions are exported too."
      props={[
        'TimeInputProps',
        'LabelledProps',
        'EasingSelectProps',
        'EasingOption',
        'RotationInputProps',
        'Quaternion',
      ]}
      code={`type Ease = 'linear' | 'in' | 'inOut';

const EASES: readonly EasingOption<Ease>[] = [
  { value: 'linear', label: 'Linear', curve: (u) => u },
  { value: 'in', label: 'Ease in', curve: (u) => u * u },
  // shortcut = a hotkey id from your bindings table: the tooltip shows its combo
  { value: 'inOut', label: 'Ease in-out', curve: (u) => u * u * (3 - 2 * u), shortcut: 'key.easeInOut' },
];

function KeyFields() {
  const [t, setT] = useState(12.5);
  const [ease, setEase] = useState<Ease>('inOut');
  const [q, setQ] = useState<Quaternion>([0, 0, 0, 1]);
  return (
    <>
      <TimeInput label="Time" labelPosition="left" tooltip="Key time (s)" value={t} onChange={setT} />
      <TimeInput label="Frame" labelPosition="left" format="frames" fps={30} value={t} onChange={setT} />
      <TimeInput label="Clock" labelPosition="left" format="mmss" value={t} onChange={setT} />
      <EasingSelect showLabels value={ease} options={EASES} onChange={setEase} />
      <RotationInput label="Rotate" value={q} onChange={setQ} />
      <RotationInput label="Axis" mode="axisAngle" value={q} onChange={setQ} />
    </>
  );
}`}
    >
      <div className="flex w-80 flex-col gap-2">
        <TimeInput
          label="Seconds"
          labelPosition="left"
          labelWidth={64}
          tooltip="Key time (s)"
          value={t}
          onChange={setT}
        />
        <TimeInput
          label="Frames"
          labelPosition="left"
          labelWidth={64}
          format="frames"
          fps={30}
          value={t}
          onChange={setT}
        />
        <TimeInput label="Clock" labelPosition="left" labelWidth={64} format="mmss" value={t} onChange={setT} />
        <EasingSelect value={ease} options={EASES} onChange={setEase} />
        <EasingSelect showLabels value={ease} options={EASES} onChange={setEase} />
        <RotationInput label="Euler" labelWidth={64} value={q} onChange={setQ} />
        <RotationInput label="Axis" labelWidth={64} mode="axisAngle" value={q} onChange={setQ} />
        <span className="text-slate-400 tabular-nums">
          t = {t.toFixed(2)} s · ease {ease} · q = [{q.map((x) => x.toFixed(3)).join(', ')}]
        </span>
      </div>
    </Section>
  );
}
