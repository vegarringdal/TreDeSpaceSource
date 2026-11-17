import { Kbd, PropertyList } from '@treDeSpaceUI/widgets';
import { Section } from './Section';

const FIELDS = [
  { key: 'tag', label: 'Tag', value: '/PLANT-A/ZONE-01/PIPE-8821' },
  { key: 'service', label: 'Service', value: 'Cooling water' },
  { key: 'dn', label: 'DN', value: '150' },
  { key: 'material', label: 'Material', value: 'CS A106 Gr.B' },
];

const CONTROLS = [
  { key: 'move', label: 'Move — fly: along view, walk: ground plane', value: <Kbd>W A S D</Kbd> },
  { key: 'updown', label: 'Move up / down', value: <Kbd>E / Q</Kbd> },
  { key: 'orbit', label: 'Orbit around the target', value: <Kbd>LMB drag</Kbd> },
];

const STATS = [
  { key: 'fps', label: 'FPS', value: '60.0' },
  { key: 'draws', label: 'Draw calls', value: '1 284' },
  { key: 'vram', label: 'VRAM', value: '1 907 MB' },
];

/** Gallery section for PropertyList. */
export function PropertyListDemo() {
  return (
    <Section
      title="PropertyList"
      note="A label/value read-out: the field list of a record, a stats block, a table of fixed controls. `fixed` (the default) gives the label a column and lets the value fill; `fill` does the opposite, for a description with a key cap after it. `numeric` right-aligns monospace values, `divided` rules each row off."
      props={['PropertyListProps', 'PropertyRow']}
      code={`function DetailFields({ fields }) {
  return (
    <PropertyList
      divided
      rows={fields.map((f) => ({
        key: f.key,
        label: f.label,
        tooltip: f.column,
        value: <DetailValue field={f} />,
      }))}
    />
  );
}`}
    >
      <div className="flex flex-col gap-4">
        <PropertyList divided rows={FIELDS} />
        <PropertyList numeric labelWidth={96} rows={STATS} />
        <PropertyList layout="fill" rows={CONTROLS} />
      </div>
    </Section>
  );
}
