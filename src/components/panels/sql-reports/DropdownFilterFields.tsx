import { Select, SqlCodeEditor, TextInput } from '@treDeSpaceUI/widgets';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef, ReportFilter } from '../../../state/sqlReports/sqlReports.state';

type DropdownFilterFieldsProps = Readonly<{
  /** The runnable draft the test dropdown queries. */
  report: ReportDef;
  filter: ReportFilter;
  onChange: (p: Partial<ReportFilter>) => void;
}>;

/** The DROPDOWN-only part of a filter's editor: search bind default, the
 *  dropdown SQL in a resizable editor, and a live test Select driven by that
 *  SQL whose picks double as the report's predefined selection. */
export function DropdownFilterFields({ report, filter: f, onChange }: DropdownFilterFieldsProps) {
  return (
    <>
      <TextInput
        value={f.searchValue ?? '%'}
        placeholder="Search bind default (usually %)"
        onChange={(v) => onChange({ searchValue: v })}
      />
      <span className="text-[11px] text-slate-500">
        Dropdown SQL — returns (id, value); ? binds the search term. FILTER_ARGS / TREE_VIEW_ARGS are seeded as in a
        run, this filter's own key holding the search term
      </span>
      <SqlCodeEditor
        resizable
        className="h-20 min-h-12"
        value={f.dropdownSql ?? ''}
        onChange={(v) => onChange({ dropdownSql: v })}
      />
      <label
        className="flex items-center gap-2 text-slate-400 text-xs"
        data-tooltip={
          'Also the predefined selection: what you pick here is saved\nwith the report and pre-selected when the report is used.'
        }
      >
        <span className="w-[90px] shrink-0">Test/selected</span>
        <div className="min-w-0 flex-1">
          <Select
            multiple
            value={f.selected ?? []}
            searchable
            placeholder="Try the dropdown…"
            loadOptions={(q) => act.dropdownOptions(report, f, q)}
            onChange={(v) => onChange({ selected: v })}
          />
        </div>
      </label>
    </>
  );
}
