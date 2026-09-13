import { IconCube } from '@tabler/icons-react';
import { Badge, Button, EmptyState, InfoButton, PanelHeader } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for PanelHeader / EmptyState. */
export function PanelChromeDemo() {
  const [rows, setRows] = useState(0);
  return (
    <Section
      title="PanelHeader / EmptyState"
      note="The two pieces of panel chrome. PanelHeader is the fixed top strip — title, dim asides, actions — in three weights: `label` over a form, `title` for the panel's own name, `band` for a mode bar. EmptyState is the one way a list or panel says it has nothing to show: a dim line in the flow, or centred in the remaining space."
      props={['PanelHeaderProps', 'EmptyStateProps']}
      code={`function ReportPanel({ report, rows }) {
  return (
    <>
      <PanelHeader
        variant="title"
        title={report.name}
        aside={<Badge>{rows.length} rows</Badge>}
        actions={<Button onClick={run}>Run</Button>}
      />
      {rows.length === 0
        ? <EmptyState layout="center">No rows — run the report.</EmptyState>
        : <Grid rows={rows} />}
    </>
  );
}`}
    >
      <div className="flex flex-col gap-4">
        <div className="border border-slate-800">
          <PanelHeader
            variant="title"
            className="px-2"
            title="Pump list"
            aside={<Badge>{rows} rows</Badge>}
            actions={
              <Button size="sm" onClick={() => setRows((n) => (n === 0 ? 128 : 0))}>
                Run
              </Button>
            }
          />
          <div className="h-28">
            {rows === 0 ? (
              <EmptyState layout="center" icon={<IconCube size={20} />}>
                No rows yet — run the report.
              </EmptyState>
            ) : (
              <div className="p-2 text-slate-300">{rows} rows loaded.</div>
            )}
          </div>
        </div>

        <div className="border border-slate-800 p-2">
          <PanelHeader title="Import" actions={<InfoButton>Everything is converted in your browser.</InfoButton>} />
          <EmptyState>No files staged.</EmptyState>
        </div>

        <div className="border border-slate-800">
          <PanelHeader
            variant="band"
            title="Viewpoint 3"
            aside={<Badge tone="warning">unsaved edits</Badge>}
            actions={<Button size="sm">Save</Button>}
          />
        </div>
      </div>
    </Section>
  );
}
