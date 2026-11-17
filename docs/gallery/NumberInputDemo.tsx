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
      note="A stepper with a 'rolling' middle: type into it, click − / +, scroll the wheel over it, or press and drag horizontally like a Blender field. Enter or blur commits, Escape reverts, ↑ / ↓ step while typing; every change is clamped to min / max and rounded to `precision` (derived from `step`, default 1). Takes the shared label props (top / left / split), a `tooltip` + `shortcut` for the field, and `decShortcut` / `incShortcut` hotkey ids for the − / + buttons."
      props={['NumberInputProps', 'LabelledProps']}
      code={`function Transform() {
  const [scale, setScale] = useState(1);
  const [angle, setAngle] = useState(45);
  // decShortcut / incShortcut: hotkey ids from your bindings table (the − / + tooltips show the combo)
  return (
    <>
      <NumberInput label="Scale" labelPosition="left" labelWidth={44}
        min={0.4} max={2} step={0.05} precision={2} unit="×"
        value={scale} onChange={setScale} />
      <NumberInput label="Angle" labelPosition="left" labelWidth={44}
        min={0} max={360} step={5} unit="°" tooltip="Rotation about Z"
        decShortcut="transform.angleDown" incShortcut="transform.angleUp"
        value={angle} onChange={setAngle} />
    </>
  );
}`}
    >
      <NumberInput
        label="Scale — type, click −/+, scroll, or drag sideways"
        min={0.4}
        max={2}
        step={0.05}
        precision={2}
        unit="×"
        value={scale}
        onChange={setScale}
      />
      <NumberInput
        className="mt-3"
        label="Angle"
        min={0}
        max={360}
        step={5}
        unit="°"
        tooltip="Rotation about Z"
        value={angle}
        onChange={setAngle}
      />
    </Section>
  );
}
