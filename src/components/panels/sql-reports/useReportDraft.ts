import { useState } from 'react';
import { parseAttachPaths } from '../../../lib/sqlite/sqlAttach';
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

  const toggleType = (t: ReportType): void =>
    patch({ types: draft.types.includes(t) ? draft.types.filter((x) => x !== t) : [...draft.types, t] });

  const setFilter = (i: number, p: Partial<ReportFilter>): void =>
    patch({ filters: draft.filters.map((f, k) => (k === i ? { ...f, ...p } : f)) });
  const addFilter = (): void =>
    patch({ filters: [...draft.filters, { kind: 'INPUT', key: `arg${draft.filters.length + 1}`, label: '' }] });
  const removeFilter = (i: number): void => patch({ filters: draft.filters.filter((_, k) => k !== i) });

  // run the DRAFT (unsaved edits included) so you can test before saving
  const eff = (): ReportDef => ({
    ...draft,
    databases: [...new Set([draft.db, ...parseAttachPaths(draft.sql)].filter(Boolean))],
  });

  return { draft, patch, toggleType, setFilter, addFilter, removeFilter, eff };
}
