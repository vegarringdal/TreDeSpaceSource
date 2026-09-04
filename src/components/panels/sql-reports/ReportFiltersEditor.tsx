import { IconPlus } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import type { ReportDef, ReportFilter } from '../../../state/sqlReports/sqlReports.state';
import { FilterEditRow } from './FilterEditRow';

type ReportFiltersEditorProps = Readonly<{
  /** The runnable draft — dropdown filters test their SQL against it. */
  report: ReportDef;
  filters: ReportFilter[];
  onChange: (i: number, p: Partial<ReportFilter>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  /** Hotkey id for the Add filter button (the SQL Editor binds one). */
  addShortcut?: string;
}>;

/** The Filters block of a report draft: header + Add filter, then one
 *  FilterEditRow per filter. */
export function ReportFiltersEditor({
  report,
  filters,
  onChange,
  onAdd,
  onRemove,
  addShortcut,
}: ReportFiltersEditorProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-slate-400 text-xs">Filters</span>
        <Button icon={<IconPlus size={14} />} shortcut={addShortcut} tooltip="Add a filter input" onClick={onAdd}>
          Add filter
        </Button>
      </div>
      {filters.map((f, i) => (
        <FilterEditRow
          // biome-ignore lint/suspicious/noArrayIndexKey: filters are edited positionally (add/remove by index)
          key={i}
          report={report}
          filter={f}
          onChange={(p) => onChange(i, p)}
          onRemove={() => onRemove(i)}
        />
      ))}
    </>
  );
}
