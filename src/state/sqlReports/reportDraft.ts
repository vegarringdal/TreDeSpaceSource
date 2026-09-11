// Pure edits of a ReportDef draft — shared by the report editor's local draft
// (useReportDraft) and the SQL Editor's store-backed one (sqlEditor.actions).
import { parseAttachPaths } from '../../lib/sqlite/sqlAttach';
import type { ReportDef, ReportFilter, ReportType } from './sqlReports.state';

/** Display order of the type checkboxes — the coloring outputs first, then
 *  table and detail, the order the SQL Editor's action rows use. */
export const ALL_REPORT_TYPES: readonly ReportType[] = ['COLORING', 'TABLE', 'DETAIL'];

/** The draft with `databases` recomputed: main db + every ATTACH literal in
 *  the SQL — the files a run Web-Locks. Never contains ''. */
export function withDatabases(d: ReportDef): ReportDef {
  return { ...d, databases: [...new Set([d.db, ...parseAttachPaths(d.sql)].filter(Boolean))] };
}

export function toggleReportType(d: ReportDef, t: ReportType): ReportDef {
  return { ...d, types: d.types.includes(t) ? d.types.filter((x) => x !== t) : [...d.types, t] };
}

export function setReportFilter(d: ReportDef, i: number, p: Partial<ReportFilter>): ReportDef {
  return { ...d, filters: d.filters.map((f, k) => (k === i ? { ...f, ...p } : f)) };
}

/** Append an INPUT filter keyed `argN` (N = its 1-based position). */
export function addReportFilter(d: ReportDef): ReportDef {
  return { ...d, filters: [...d.filters, { kind: 'INPUT', key: `arg${d.filters.length + 1}`, label: '' }] };
}

export function removeReportFilter(d: ReportDef, i: number): ReportDef {
  return { ...d, filters: d.filters.filter((_, k) => k !== i) };
}

/** Swap filter `i` with its neighbour in direction `dir` — the list order is
 *  the order the inputs are shown in when the report is used. A move off
 *  either end returns the draft unchanged. */
export function moveReportFilter(d: ReportDef, i: number, dir: -1 | 1): ReportDef {
  const j = i + dir;
  if (i < 0 || i >= d.filters.length || j < 0 || j >= d.filters.length) {
    return d;
  }
  const filters = [...d.filters];
  [filters[i], filters[j]] = [filters[j], filters[i]];
  return { ...d, filters };
}
