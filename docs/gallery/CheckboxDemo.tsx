import { Checkbox } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for Checkbox. */
export function CheckboxDemo() {
  const [edges, setEdges] = useState(true);
  const [replace, setReplace] = useState(false);
  const [taa, setTaa] = useState(true);
  return (
    <Section
      title="Checkbox"
      note="A single on/off toggle — the standalone sibling of a RadioGroup row, same settings-panel visual language. Carries an optional dim hint or a longer info popover."
      props={['CheckboxProps']}
      code={`function ImportOptions() {
  const [replace, setReplace] = useState(false);
  return (
    <Checkbox
      checked={replace}
      onChange={setReplace}
      label="replace if exists"
      info="Deletes any prior asset with the same store, folder and name."
    />
  );
}`}
    >
      <div className="flex flex-col gap-1.5">
        <Checkbox checked={edges} onChange={setEdges} label="Draw edges" hint="per-sample MSAA edges" />
        <Checkbox
          checked={replace}
          onChange={setReplace}
          label="replace if exists"
          info="Deletes any prior asset with the same store, folder and name."
        />
        <Checkbox checked={taa} onChange={setTaa} label="TAA (disabled)" disabled />
      </div>
    </Section>
  );
}
