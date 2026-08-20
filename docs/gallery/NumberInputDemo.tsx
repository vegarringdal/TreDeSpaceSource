import { NumberInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for NumberInput. */
export function NumberInputDemo() {
  const [scale, setScale] = useState(1);
  const [angle, setAngle] = useState(45);
  return (
    <Section
      title="NumberInput"
      note="A stepper with a 'rolling' middle: type into it, click − / +, scroll the wheel over it, or press and drag horizontally like a Blender field. Enter commits, Escape reverts."
      props={['NumberInputProps']}
      code={`function Transform() {
  const [scale, setScale] = useState(1);
  const [angle, setAngle] = useState(45);
  return (
    <>
      <NumberInput min={0.4} max={2} step={0.05} precision={2}
        unit="×" value={scale} onChange={setScale} />
      <NumberInput min={0} max={360} step={5} unit="°"
        value={angle} onChange={setAngle} />
    </>
  );
}`}
    >
      <label className="mb-1 block text-slate-400 text-xs">Scale — type, click −/+, scroll, or drag sideways</label>
      <NumberInput min={0.4} max={2} step={0.05} precision={2} unit="×" value={scale} onChange={setScale} />
      <label className="mt-3 mb-1 block text-slate-400 text-xs">Angle</label>
      <NumberInput min={0} max={360} step={5} unit="°" value={angle} onChange={setAngle} />
    </Section>
  );
}
