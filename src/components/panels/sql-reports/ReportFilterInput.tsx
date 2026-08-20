import { Select, TextInput } from '@treDeSpaceUI/widgets';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef, ReportFilter } from '../../../state/sqlReports/sqlReports.state';
import { stringsOr } from './reportValues';

type ReportFilterInputProps = Readonly<{
  report: ReportDef;
  filter: ReportFilter;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
}>;

/** One filter's run-time input: a text box (INPUT) or an async multi Select
 *  driven by the filter's dropdownSql (DROPDOWN). */
export function ReportFilterInput({ report, filter, value, onChange }: ReportFilterInputProps) {
  const label = filter.label || filter.key;
  if (filter.kind === 'INPUT') {
    return (
      <TextInput
        label={label}
        labelPosition="left"
        labelWidth={90}
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
      />
    );
  }

  return (
    <label className="flex items-center gap-2 text-slate-400 text-xs">
      <span className="w-[90px] shrink-0 truncate">{label}</span>
      <div className="min-w-0 flex-1">
        <Select
          multiple
          value={stringsOr(value, undefined) ?? []}
          searchable
          placeholder="Select…"
          loadOptions={(q) => act.dropdownOptions(report, filter.dropdownSql ?? '', q, filter.searchValue ?? '%')}
          onChange={onChange}
        />
      </div>
    </label>
  );
}
