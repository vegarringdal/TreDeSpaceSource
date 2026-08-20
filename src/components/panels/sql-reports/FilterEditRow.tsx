import { IconTrash } from '@tabler/icons-react';
import { Button, Select, SqlCodeEditor, TextInput } from '@treDeSpaceUI/widgets';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef, ReportFilter } from '../../../state/sqlReports/sqlReports.state';

type FilterEditRowProps = Readonly<{
  report: ReportDef;
  filter: ReportFilter;
  onChange: (p: Partial<ReportFilter>) => void;
  onRemove: () => void;
}>;

/** One filter's editor. Dropdown filters get a resizable SQL editor AND a live
 *  test dropdown driven by that SQL, so the query can be tried in place. */
export function FilterEditRow({ report, filter: f, onChange, onRemove }: FilterEditRowProps) {
  return (
    <div className="flex flex-col gap-1.5 border border-slate-800 p-1.5">
      <div className="flex items-center gap-1.5">
        <div className="w-28 shrink-0">
          <Select
            value={f.kind}
            options={[
              { value: 'INPUT', label: 'Input' },
              { value: 'DROPDOWN', label: 'Dropdown' },
            ]}
            onChange={(v) => onChange({ kind: v === 'DROPDOWN' ? 'DROPDOWN' : 'INPUT' })}
          />
        </div>
        <TextInput value={f.key} placeholder="key (FILTER_ARGS.k)" onChange={(v) => onChange({ key: v })} />
        <TextInput value={f.label} placeholder="Label" onChange={(v) => onChange({ label: v })} />
        <Button icon={<IconTrash size={14} />} tooltip="Remove this filter" onClick={onRemove} />
      </div>
      {f.kind === 'INPUT' ? (
        <TextInput
          value={f.value ?? ''}
          placeholder="Default value (optional)"
          onChange={(v) => onChange({ value: v })}
        />
      ) : (
        <>
          <TextInput
            value={f.searchValue ?? '%'}
            placeholder="Search bind default (usually %)"
            onChange={(v) => onChange({ searchValue: v })}
          />
          <span className="text-[11px] text-slate-500">
            Dropdown SQL — returns (id, value); ? binds the search term
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
            <span className="w-16 shrink-0">Test/selected</span>
            <div className="min-w-0 flex-1">
              <Select
                multiple
                value={f.selected ?? []}
                searchable
                placeholder="Try the dropdown…"
                loadOptions={(q) => act.dropdownOptions(report, f.dropdownSql ?? '', q, f.searchValue ?? '%')}
                onChange={(v) => onChange({ selected: v })}
              />
            </div>
          </label>
        </>
      )}
    </div>
  );
}
