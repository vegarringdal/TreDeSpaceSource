import { IconAsterisk, IconEqual } from '@tabler/icons-react';
import { SegmentedControl } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

const UNITS = [
  { value: 'mm', label: 'mm', tooltip: 'Step unit: millimeters' },
  { value: 'cm', label: 'cm', tooltip: 'Step unit: centimeters' },
  { value: 'm', label: 'm', tooltip: 'Step unit: meters' },
] as const;

const MATCH = [
  { value: 'contains', icon: <IconAsterisk />, tooltip: 'Contains' },
  { value: 'exact', icon: <IconEqual />, tooltip: 'Equals' },
] as const;

/** Gallery section for SegmentedControl. */
export function SegmentedDemo() {
  const [unit, setUnit] = useState<'mm' | 'cm' | 'm'>('cm');
  const [match, setMatch] = useState<'contains' | 'exact'>('contains');
  return (
    <Section
      title="SegmentedControl"
      note="A run of joined buttons for one exclusive choice — the horizontal sibling of RadioGroup, for a mode switch that belongs in a toolbar rather than a form. Generic over the value union, so onChange hands back your own literal type. Labels, icons, or both; `grow` splits the row evenly."
      props={['SegmentedControlProps', 'SegmentedOption']}
      code={`const UNITS = [
  { value: 'mm', label: 'mm', tooltip: 'Step unit: millimeters' },
  { value: 'cm', label: 'cm', tooltip: 'Step unit: centimeters' },
  { value: 'm',  label: 'm',  tooltip: 'Step unit: meters' },
] as const;

function StepUnit() {
  const [unit, setUnit] = useState<'mm' | 'cm' | 'm'>('cm');
  return <SegmentedControl value={unit} options={UNITS} onChange={setUnit} />;
}`}
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl value={unit} options={UNITS} onChange={setUnit} />
        <SegmentedControl value={match} options={MATCH} onChange={setMatch} />
        <SegmentedControl grow size="sm" value={unit} options={UNITS} onChange={setUnit} />
        <span className="text-slate-400">
          unit: {unit} · match: {match}
        </span>
      </div>
    </Section>
  );
}
