import { IconChevronsDown, IconChevronsUp, IconPlus } from '@tabler/icons-react';
import { cn } from '@treDeSpaceUI/lib/cn';
import { Button } from '@treDeSpaceUI/widgets';
import { type FilterCollapseControls, isFilterCollapsed } from '../../../state/sqlReports/filterCollapse';
import type { ReportDef, ReportFilter } from '../../../state/sqlReports/sqlReports.state';
import { FilterEditRow } from './FilterEditRow';

type ReportFiltersEditorProps = Readonly<{
  /** The runnable draft — dropdown filters test their SQL against it. */
  report: ReportDef;
  filters: ReportFilter[];
  onChange: (i: number, p: Partial<ReportFilter>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  /** Swap filter `i` with its neighbour (-1 = up, 1 = down). */
  onMove: (i: number, dir: -1 | 1) => void;
  /** Which sections are folded shut, and the toggles — owned with the draft
   *  so the flags follow a filter through move / remove. */
  collapse: FilterCollapseControls;
  /** Hotkey ids for the header buttons (the SQL Editor binds them). */
  shortcuts?: Readonly<{ add?: string; expandAll?: string; collapseAll?: string }>;
  /** Classes for the scrolling list of filter rows — by default it caps at
   *  `max-h-72` and scrolls; a host with its own height (the SQL Editor
   *  panel) passes `max-h-none min-h-40 flex-1` so the list fills the spare
   *  height instead. */
  listClassName?: string;
}>;

/** The Filters block of a report draft: a header with Expand all / Collapse
 *  all + Add filter, then one collapsible FilterEditRow per filter, in the
 *  order the inputs are shown at run time. */
export function ReportFiltersEditor({
  report,
  filters,
  onChange,
  onAdd,
  onRemove,
  onMove,
  collapse,
  shortcuts,
  listClassName,
}: ReportFiltersEditorProps) {
  const isEmpty = filters.length === 0;
  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <span className="flex-1 text-slate-400 text-xs">Filters</span>
        <Button
          iconOnly
          icon={<IconChevronsDown size={14} />}
          disabled={isEmpty}
          shortcut={shortcuts?.expandAll}
          tooltip="Expand all filters"
          onClick={collapse.expandAll}
        />
        <Button
          iconOnly
          icon={<IconChevronsUp size={14} />}
          disabled={isEmpty}
          shortcut={shortcuts?.collapseAll}
          tooltip="Collapse all filters"
          onClick={collapse.collapseAll}
        />
        <Button icon={<IconPlus size={14} />} shortcut={shortcuts?.add} tooltip="Add a filter input" onClick={onAdd}>
          Add filter
        </Button>
      </div>
      {!isEmpty && (
        <div className={cn('flex max-h-72 min-h-0 flex-col gap-1.5 overflow-y-auto', listClassName)}>
          {filters.map((f, i) => (
            <FilterEditRow
              // biome-ignore lint/suspicious/noArrayIndexKey: filters are edited positionally (add/remove/move by index)
              key={i}
              report={report}
              filter={f}
              index={i}
              isFirst={i === 0}
              isLast={i === filters.length - 1}
              collapsed={isFilterCollapsed(collapse.collapsed, i)}
              onToggle={() => collapse.toggle(i)}
              onChange={(p) => onChange(i, p)}
              onRemove={() => onRemove(i)}
              onMove={(dir) => onMove(i, dir)}
            />
          ))}
        </div>
      )}
    </>
  );
}
