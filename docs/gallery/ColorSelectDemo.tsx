import { ColorSelect } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for ColorSelect. */
export function ColorSelectDemo() {
  const [color, setColor] = useState('#4f8cff');
  return (
    <Section
      title="ColorSelect"
      note="The one colour picker: saturation/value area, hue bar, hex + RGB entry, and quick swatches, in a popover portaled to the body. Values are always #rrggbb (onChange hands back lowercase). A host can swap the default swatch grid with setColorSelectSwatchesStore(); a `swatches` list replaces it for one picker. `compact` drops the hex text for a toolbar-sized trigger — put the colour in the tooltip if it matters."
      props={['ColorSelectProps', 'ColorSelectSwatchesStore', 'LabelledProps']}
      code={`function TintPicker() {
  const [color, setColor] = useState('#4f8cff');
  return (
    <>
      <ColorSelect label="Tint" labelPosition="left" value={color} onChange={setColor}
        swatches={['#ff5533', '#4f8cff', '#3ddc84']} />
      {/* compact: swatch + arrow only, for a toolbar */}
      <ColorSelect compact tooltip="Highlight colour" value={color} onChange={setColor} />
    </>
  );
}`}
    >
      <div className="flex items-center gap-2">
        <ColorSelect value={color} onChange={setColor} />
        <span className="font-mono text-slate-400 text-xs">{color}</span>
        <ColorSelect compact value={color} onChange={setColor} tooltip="compact: swatch only, for toolbars" />
      </div>
    </Section>
  );
}
