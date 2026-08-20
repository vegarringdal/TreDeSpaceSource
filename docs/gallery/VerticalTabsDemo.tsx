import { VerticalTabs } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for VerticalTabs. */
export function VerticalTabsDemo() {
  const [tab, setTab] = useState('transform');
  return (
    <Section
      title="VerticalTabs"
      note="A tab strip that runs down the side instead of across the top — this very page is one. Omit a tab's label (keep a tooltip) for an icon-only rail; the strip can sit on either side. Uncontrolled by default; pass value/onChange to control it."
      props={['VerticalTabsProps', 'VerticalTab']}
      code={`function Inspector() {
  const [tab, setTab] = useState('transform');
  return (
    <VerticalTabs value={tab} onChange={setTab} tabs={[
      { id: 'transform', label: 'Transform', content: <Transform /> },
      { id: 'material', label: 'Material', content: <Material /> },
      { id: 'physics', label: 'Physics', content: <Physics /> },
    ]} />
  );
}`}
    >
      <VerticalTabs
        className="h-36 rounded border border-slate-800"
        value={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'transform',
            label: 'Transform',
            content: <p className="m-0 p-2 text-slate-400">Position, rotation, scale.</p>,
          },
          {
            id: 'material',
            label: 'Material',
            content: <p className="m-0 p-2 text-slate-400">Shader, maps, blending.</p>,
          },
          {
            id: 'physics',
            label: 'Physics',
            content: <p className="m-0 p-2 text-slate-400">Collider, mass, damping.</p>,
          },
        ]}
      />
      <p className="m-0 mt-2 text-slate-500 text-xs">Active tab (controlled): {tab}</p>
    </Section>
  );
}
