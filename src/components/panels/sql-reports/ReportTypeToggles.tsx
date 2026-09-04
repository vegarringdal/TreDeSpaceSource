import { ALL_REPORT_TYPES } from '../../../state/sqlReports/reportDraft';
import type { ReportDef, ReportType } from '../../../state/sqlReports/sqlReports.state';

type ReportTypeTogglesProps = Readonly<{
  draft: ReportDef;
  toggleType: (t: ReportType) => void;
}>;

/** The TABLE / COLORING / DETAIL checkboxes: which outputs a report offers. */
export function ReportTypeToggles({ draft, toggleType }: ReportTypeTogglesProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-slate-300 text-xs">
      <span className="w-[70px] shrink-0 text-slate-400">Types</span>
      {ALL_REPORT_TYPES.map((t) => (
        <label key={t} className="flex cursor-pointer items-center gap-1.5" data-tooltip={`Enable the ${t} output`}>
          <input type="checkbox" checked={draft.types.includes(t)} onChange={() => toggleType(t)} />
          {t}
        </label>
      ))}
    </div>
  );
}
