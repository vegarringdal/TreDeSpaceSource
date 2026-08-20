import { ColorSelect } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for ColorSelect. */
export function ColorSelectDemo() {
  const [color, setColor] = useState('#4f8cff');
  return (
    <Section
      title="ColorSelect"
      note="The one colour picker: saturation/value area, hue bar, hex + RGB entry, and quick swatches, in a popover portaled to the body. Values are always #rrggbb. A host can swap the default swatch grid with setColorSelectSwatchesStore()."
      props={['ColorSelectProps', 'ColorSelectSwatchesStore']}
      code={`function TintPicker() {
  const [color, setColor] = useState('#4f8cff');
  return (
    <ColorSelect value={color} onChange={setColor}
      swatches={['#ff5533', '#4f8cff', '#3ddc84']} />
  );
}`}
    >
      <div className="flex items-center gap-2">
        <ColorSelect value={color} onChange={setColor} />
        <span className="font-mono text-slate-400 text-xs">{color}</span>
      </div>
    </Section>
  );
}
