// The SQL Editor draft on the wire (`sql.editor` in, `sql.editor.get` out).
// Pure — no ApiError import (that module pulls the stores state in), so the
// handler turns `error` into a bad-payload. Unit-tested.
import { ALL_REPORT_TYPES } from '../../state/sqlReports/reportDraft';
import type { ReportDef, ReportFilter, ReportType } from '../../state/sqlReports/sqlReports.state';

/** What `sql.editor.get` answers and `sql.editor` accepts back: the draft's
 *  report fields under the host-facing names — `title` is the report name
 *  (`name` on `sql.editor` already titles an appended block). */
export interface EditorDraftPayload {
  title: string;
  description: string;
  mainDb: string;
  types: ReportType[];
  sql: string;
  filters: ReportFilter[];
  /** Every database a run locks: the main db + ATTACH'd paths. */
  databases: string[];
}

export type EditorDraftPatch = Partial<Pick<ReportDef, 'name' | 'description' | 'types' | 'filters'>>;

export type ParsedEditorDraft = Readonly<{ patch?: EditorDraftPatch; error?: string }>;

const STRING_FILTER_FIELDS = ['value', 'searchValue', 'dropdownSql'] as const;

class PayloadError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isReportType(v: unknown): v is ReportType {
  return typeof v === 'string' && ALL_REPORT_TYPES.some((t) => t === v);
}

function parseFilter(v: unknown, i: number): ReportFilter {
  if (!isRecord(v)) {
    throw new PayloadError(`filters[${i}] must be an object`);
  }
  const key = typeof v.key === 'string' ? v.key.trim() : '';
  if (!key) {
    throw new PayloadError(`filters[${i}].key must be a non-empty string`);
  }
  const kind = v.kind === undefined ? 'INPUT' : v.kind;
  if (kind !== 'INPUT' && kind !== 'DROPDOWN') {
    throw new PayloadError(`filters[${i}].kind must be INPUT or DROPDOWN`);
  }
  const f: ReportFilter = { kind, key, label: typeof v.label === 'string' ? v.label : key };
  for (const field of STRING_FILTER_FIELDS) {
    const val = v[field];
    if (val === undefined) {
      continue;
    }
    if (typeof val !== 'string') {
      throw new PayloadError(`filters[${i}].${field} must be a string`);
    }
    f[field] = val;
  }
  if (v.selected !== undefined) {
    if (!Array.isArray(v.selected) || v.selected.some((x) => typeof x !== 'string')) {
      throw new PayloadError(`filters[${i}].selected must be a string[]`);
    }
    f.selected = v.selected.map(String);
  }
  return f;
}

/** The draft fields a `sql.editor` payload carries (`title`, `description`,
 *  `types`, `filters`), validated. Fields left out are left alone; a bad one
 *  fails the whole payload before anything changes. */
export function parseEditorDraft(p: Record<string, unknown>): ParsedEditorDraft {
  try {
    const patch: EditorDraftPatch = {};
    if (p.title !== undefined) {
      if (typeof p.title !== 'string') {
        throw new PayloadError('title must be a string');
      }
      patch.name = p.title;
    }
    if (p.description !== undefined) {
      if (typeof p.description !== 'string') {
        throw new PayloadError('description must be a string');
      }
      patch.description = p.description;
    }
    if (p.types !== undefined) {
      if (!Array.isArray(p.types) || !p.types.every(isReportType)) {
        throw new PayloadError(`types must be an array of ${ALL_REPORT_TYPES.join(' | ')}`);
      }
      patch.types = [...new Set(p.types)];
    }
    if (p.filters !== undefined) {
      if (!Array.isArray(p.filters)) {
        throw new PayloadError('filters must be an array');
      }
      patch.filters = p.filters.map(parseFilter);
    }
    return { patch };
  } catch (e) {
    if (e instanceof PayloadError) {
      return { error: e.message };
    }
    throw e;
  }
}

/** The draft as `sql.editor.get` answers it — copies, so the store's objects
 *  never cross the boundary. */
export function editorDraftPayload(d: ReportDef): EditorDraftPayload {
  return {
    title: d.name,
    description: d.description,
    mainDb: d.db,
    types: [...d.types],
    sql: d.sql,
    filters: d.filters.map((f) => ({ ...f, ...(f.selected ? { selected: [...f.selected] } : {}) })),
    databases: [...d.databases],
  };
}
