import { Collapsible } from '@treDeSpaceUI/widgets';
import { Section } from './Section';

/** Gallery section for Collapsible. */
export function CollapsibleDemo() {
  return (
    <Section
      title="Collapsible"
      note="A titled section that collapses — for organising long settings tabs. The header can carry a right-aligned aside (count, badge) and an info popover."
      props={['CollapsibleProps']}
      code={`function RenderingSettings() {
  return (
    <Collapsible title="Rendering" aside="2 settings"
      info="Explanation behind the info icon.">
      <AntiAliasing />
      <AmbientOcclusion />
    </Collapsible>
  );
}`}
    >
      <Collapsible title="Rendering" aside="2 settings" info="These settings only affect the demo text below.">
        <p className="m-0 py-1 text-slate-400">Anti-aliasing, ambient occlusion…</p>
      </Collapsible>
      <Collapsible title="Collapsed by default" defaultOpen={false}>
        <p className="m-0 py-1 text-slate-400">Sections animate open and closed without measuring.</p>
      </Collapsible>
    </Section>
  );
}
