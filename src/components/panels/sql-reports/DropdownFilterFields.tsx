import { Checkbox, Select, SqlCodeEditor, TextInput } from '@treDeSpaceUI/widgets';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef, ReportFilter } from '../../../state/sqlReports/sqlReports.state';

const TEST_TOOLTIP =
  'Also the predefined selection: what you pick here is saved\nwith the report and pre-selected when the report is used.';

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
  const selected = f.selected ?? [];
  const loadOptions = (q: string) => act.dropdownOptions(report, f, q);

  // turning single on keeps the first pick — the rest can no longer be chosen
  const handleSingle = (single: boolean) => {
    onChange({ single, selected: single ? selected.slice(0, 1) : selected });
  };

  return (
    <>
      <TextInput
        value={f.searchValue ?? '%'}
        placeholder="Search bind default (usually %)"
        onChange={(v) => onChange({ searchValue: v })}
      />
      <span className="text-[11px] text-slate-500">
        Dropdown SQL — name the columns id and label (any order; unnamed = first is the id, second the text); ? binds
        the search term. FILTER_ARGS / TREE_VIEW_ARGS are seeded as in a run, this filter's own key holding the search
        term
      </span>
      <SqlCodeEditor
        resizable
        className="h-20 min-h-12"
        value={f.dropdownSql ?? ''}
        onChange={(v) => onChange({ dropdownSql: v })}
      />
      <Checkbox
        label="Single select"
        checked={f.single === true}
        tooltip="Let the report's user pick ONE option instead of several (the picks still reach the SQL as FILTER_ARGS rows — at most one)"
        onChange={handleSingle}
      />
      {f.single ? (
        <Select
          label="Test/selected"
          labelPosition="left"
          labelWidth={90}
          tooltip={TEST_TOOLTIP}
          value={selected[0] ?? null}
          searchable
          placeholder="Try the dropdown…"
          loadOptions={loadOptions}
          onChange={(v) => onChange({ selected: v ? [v] : [] })}
        />
      ) : (
        <Select
          multiple
          label="Test/selected"
          labelPosition="left"
          labelWidth={90}
          tooltip={TEST_TOOLTIP}
          value={selected}
          searchable
          placeholder="Try the dropdown…"
          loadOptions={loadOptions}
          onChange={(v) => onChange({ selected: v })}
        />
      )}
    </>
  );
}
