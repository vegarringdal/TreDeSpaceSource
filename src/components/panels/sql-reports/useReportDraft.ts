import { useState } from 'react';
import {
  type FilterCollapse,
  type FilterCollapseControls,
  moveFilterCollapsed,
  removeFilterCollapsed,
  setAllFiltersCollapsed,
  toggleFilterCollapsed,
} from '../../../state/sqlReports/filterCollapse';
import {
  addReportFilter,
  moveReportFilter,
  removeReportFilter,
  setReportFilter,
  toggleReportType,
  withDatabases,
} from '../../../state/sqlReports/reportDraft';
import type { ReportDef, ReportFilter, ReportType } from '../../../state/sqlReports/sqlReports.state';

export type ReportDraft = Readonly<{
  draft: ReportDef;
  patch: (p: Partial<ReportDef>) => void;
  toggleType: (t: ReportType) => void;
  setFilter: (i: number, p: Partial<ReportFilter>) => void;
  addFilter: () => void;
  removeFilter: (i: number) => void;
  moveFilter: (i: number, dir: -1 | 1) => void;
  /** Collapse flags of the filter sections — local to this editor instance,
   *  never part of the draft. */
  collapse: FilterCollapseControls;
  eff: () => ReportDef;
}>;

/** The editor's local, unsaved copy of a report. `eff()` builds the runnable
 *  draft (databases = main db + every ATTACH'd path in the SQL) so edits can
 *  be tested before saving. */
export function useReportDraft(report: ReportDef): ReportDraft {
  const [draft, setDraft] = useState<ReportDef>(report);
  const [collapsed, setCollapsed] = useState<FilterCollapse>([]);
  const count = draft.filters.length;
  const patch = (p: Partial<ReportDef>): void => setDraft((d) => ({ ...d, ...p }));
  const toggleType = (t: ReportType): void => setDraft((d) => toggleReportType(d, t));
  const setFilter = (i: number, p: Partial<ReportFilter>): void => setDraft((d) => setReportFilter(d, i, p));
  const addFilter = (): void => setDraft(addReportFilter);
  const removeFilter = (i: number): void => {
    setDraft((d) => removeReportFilter(d, i));
    setCollapsed((c) => removeFilterCollapsed(c, i));
  };
  const moveFilter = (i: number, dir: -1 | 1): void => {
    setDraft((d) => moveReportFilter(d, i, dir));
    setCollapsed((c) => moveFilterCollapsed(c, i, dir, count));
  };
  const collapse: FilterCollapseControls = {
    collapsed,
    toggle: (i) => setCollapsed((c) => toggleFilterCollapsed(c, i)),
    expandAll: () => setCollapsed(setAllFiltersCollapsed(count, false)),
    collapseAll: () => setCollapsed(setAllFiltersCollapsed(count, true)),
  };

  // run the DRAFT (unsaved edits included) so you can test before saving
  const eff = (): ReportDef => withDatabases(draft);

  return { draft, patch, toggleType, setFilter, addFilter, removeFilter, moveFilter, collapse, eff };
}
