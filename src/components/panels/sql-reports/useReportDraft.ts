import { useState } from 'react';
import {
  addReportFilter,
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
  eff: () => ReportDef;
}>;

/** The editor's local, unsaved copy of a report. `eff()` builds the runnable
 *  draft (databases = main db + every ATTACH'd path in the SQL) so edits can
 *  be tested before saving. */
export function useReportDraft(report: ReportDef): ReportDraft {
  const [draft, setDraft] = useState<ReportDef>(report);
  const patch = (p: Partial<ReportDef>): void => setDraft((d) => ({ ...d, ...p }));
  const toggleType = (t: ReportType): void => setDraft((d) => toggleReportType(d, t));
  const setFilter = (i: number, p: Partial<ReportFilter>): void => setDraft((d) => setReportFilter(d, i, p));
  const addFilter = (): void => setDraft(addReportFilter);
  const removeFilter = (i: number): void => setDraft((d) => removeReportFilter(d, i));

  // run the DRAFT (unsaved edits included) so you can test before saving
  const eff = (): ReportDef => withDatabases(draft);

  return { draft, patch, toggleType, setFilter, addFilter, removeFilter, eff };
}
