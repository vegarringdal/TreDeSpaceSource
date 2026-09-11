import { IconRestore } from '@tabler/icons-react';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for Collapsible. */
export function CollapsibleDemo() {
  const [edits, setEdits] = useState(0);

  return (
    <Section
      title="Collapsible"
      note="A titled section that collapses — for organising long settings tabs. The header can carry a right-aligned aside (count, badge), action buttons (a reset that greys out at defaults) and an info popover."
      props={['CollapsibleProps']}
      code={`function RenderingSettings() {
  const [edits, setEdits] = useState(0);
  return (
    <Collapsible title="Rendering" aside={\`\${edits} edits\`}
      info="Explanation behind the info icon."
      actions={<Button iconOnly icon={<IconRestore size={14} />}
        disabled={edits === 0} tooltip="Reset to defaults"
        onClick={() => setEdits(0)} />}>
      <Button onClick={() => setEdits((n) => n + 1)}>Edit</Button>
    </Collapsible>
  );
}`}
    >
      <Collapsible
        title="Rendering"
        aside={`${edits} edits`}
        info="These settings only affect the demo text below."
        actions={
          <Button
            iconOnly
            icon={<IconRestore size={14} />}
            disabled={edits === 0}
            tooltip="Reset to defaults"
            onClick={() => setEdits(0)}
          />
        }
      >
        <p className="m-0 py-1 text-slate-400">Anti-aliasing, ambient occlusion…</p>
        <Button className="self-start" onClick={() => setEdits((n) => n + 1)}>
          Edit a setting
        </Button>
      </Collapsible>
      <Collapsible title="Collapsed by default" defaultOpen={false}>
        <p className="m-0 py-1 text-slate-400">Sections animate open and closed without measuring.</p>
      </Collapsible>
    </Section>
  );
}
