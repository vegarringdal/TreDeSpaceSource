import { IconPencil } from '@tabler/icons-react';
import { Badge, Button, Collapsible } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import type { PackedNames } from '../../../lib/color/packedNames';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import { type ReportDef, sqlReportsState } from '../../../state/sqlReports/sqlReports.state';
import { RichText } from '../../shared/RichText';
import { ColorApplyBox } from './ColorApplyBox';
import { ReportFilterInput } from './ReportFilterInput';
import { ReportRunButtons } from './ReportRunButtons';
import { seedVals, stringOr, stringsOr } from './reportValues';

/** One saved report in run mode: collapsible header, description, run-time
 *  filter inputs (ephemeral — defaults come from the report) and the per-type
 *  run buttons. Editing is handed off via act.setEdit. */
export function ReportRow({ report }: { report: ReportDef }) {
  const { openId } = sqlReportsState.use();
  const open = openId === report.id;
  // ephemeral filter values (defaults come from the report; not persisted per keystroke)
  const [vals, setVals] = useState<Record<string, string | string[]>>(() => seedVals(report.filters));
  const [colorRows, setColorRows] = useState<PackedNames | null>(null);

  const effective: ReportDef = {
    ...report,
    filters: report.filters.map((f) =>
      f.kind === 'INPUT'
        ? { ...f, value: stringOr(vals[f.key], f.value) }
        : { ...f, selected: stringsOr(vals[f.key], f.selected) },
    ),
  };

  return (
    <Collapsible
      open={open}
      onToggle={(next) => act.setOpen(next ? report.id : null)}
      title={<span className="truncate font-medium text-slate-200">{report.name}</span>}
      aside={<Badge>{report.types.join(' · ')}</Badge>}
      actions={
        <Button
          iconOnly
          variant="ghost"
          icon={<IconPencil />}
          tooltip="Edit this report (shows its SQL)"
          onClick={() => act.setEdit(report.id)}
        />
      }
    >
      {report.description.trim() && <RichText block text={report.description} className="m-0 text-slate-300" />}

      {report.filters.map((f) => (
        <ReportFilterInput
          key={f.key}
          report={report}
          filter={f}
          value={vals[f.key]}
          onChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))}
        />
      ))}

      <ReportRunButtons effective={effective} onColorRows={setColorRows} />

      {colorRows && <ColorApplyBox rows={colorRows} />}
    </Collapsible>
  );
}
