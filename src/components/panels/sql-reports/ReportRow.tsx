import { IconChevronDown, IconChevronRight, IconPencil } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import type { PackedNames } from '../../../lib/color/packedNames';
import { richTextHtml } from '../../../lib/richText';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import { type ReportDef, sqlReportsState } from '../../../state/sqlReports/sqlReports.state';
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
    <div className="flex flex-col border border-slate-800">
      <div className="flex items-center gap-1 bg-slate-800/60 px-2 py-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          onClick={() => act.setOpen(open ? null : report.id)}
        >
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <span className="truncate font-medium text-slate-200 text-xs">{report.name}</span>
          <span className="ml-1 shrink-0 text-[10px] text-slate-500">{report.types.join(' · ')}</span>
        </button>
        <Button
          icon={<IconPencil size={14} />}
          tooltip="Edit this report (shows its SQL)"
          onClick={() => act.setEdit(report.id)}
        />
      </div>
      {open && (
        <div className="flex flex-col gap-2 p-2">
          {report.description.trim() && (
            <p
              className="m-0 text-slate-300"
              // richTextHtml HTML-escapes before adding <b>/<br> — no injection
              // biome-ignore lint/security/noDangerouslySetInnerHtml: escaped by richTextHtml
              dangerouslySetInnerHTML={{ __html: richTextHtml(report.description) }}
            />
          )}

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
        </div>
      )}
    </div>
  );
}
