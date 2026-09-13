import { Badge, Button, Kbd } from '@treDeSpaceUI/widgets';
import { Section } from './Section';

/** Gallery section for Badge / Kbd. */
export function BadgeDemo() {
  return (
    <Section
      title="Badge / Kbd"
      note="Badge is the one status chip — a row count, a license name, a warning marker — in five tones. Kbd is its key-cap sibling for a shortcut combo. Button takes a badge too, so a count can ride along with an action."
      props={['BadgeProps', 'KbdProps']}
      code={`function ReportHeader({ report, rows }) {
  return (
    <div className="flex items-center gap-2">
      <span>{report.name}</span>
      <Badge>{rows} rows</Badge>
      {report.stale && <Badge tone="warning">stale</Badge>}
      <span>Run with <Kbd>Ctrl + Enter</Kbd></span>
    </div>
  );
}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge>neutral</Badge>
        <Badge tone="info">info</Badge>
        <Badge tone="success">MIT</Badge>
        <Badge tone="warning">3 custom</Badge>
        <Badge tone="danger">failed</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-slate-300">
        <span>
          Run with <Kbd>Ctrl + Enter</Kbd>, cancel with <Kbd>Esc</Kbd>
        </span>
      </div>
      <div className="mt-3">
        <Button badge={12}>Selection</Button>
      </div>
    </Section>
  );
}
