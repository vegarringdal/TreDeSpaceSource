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

/** One filter's run-time input: a text box (INPUT) or an async Select driven
 *  by the filter's dropdownSql (DROPDOWN) — multi, or one pick when the
 *  filter is `single`. Either way the value handed up is a list of ids. */
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

  const selected = stringsOr(value, undefined) ?? [];
  const loadOptions = (q: string) => act.dropdownOptions(report, filter, q);

  return (
    <label className="flex items-center gap-2 text-slate-400 text-xs">
      <span className="w-[90px] shrink-0 truncate">{label}</span>
      <div className="min-w-0 flex-1">
        {filter.single ? (
          <Select
            value={selected[0] ?? null}
            searchable
            placeholder="Select…"
            loadOptions={loadOptions}
            onChange={(v) => onChange(v ? [v] : [])}
          />
        ) : (
          <Select
            multiple
            value={selected}
            searchable
            placeholder="Select…"
            loadOptions={loadOptions}
            onChange={onChange}
          />
        )}
      </div>
    </label>
  );
}
