// Report bindings for the SQL Detail panels. There is one built-in panel (key
// '') plus any number of NAMED ones the host API creates: `sql.detail` with a
// `name` gets its own dock panel titled with that name, and calling it again
// with the same name re-binds that panel instead of opening another. Named
// panels are session-only (like host-managed external apps) — the host
// re-creates them after a reload.
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';

/** The built-in panel's key — the one in the default layout. */
export const DEFAULT_DETAIL_KEY = '';

const BASE_ID = 'sqlDetail';

/** Dock panel id for a detail key ('' → the built-in panel). */
export function detailPanelId(key: string): string {
  return key ? `${BASE_ID}:${key}` : BASE_ID;
}

/** The key a panel id belongs to (the inverse of {@link detailPanelId}). */
export function detailKeyOf(panelId: string): string {
  return panelId.startsWith(`${BASE_ID}:`) ? panelId.slice(BASE_ID.length + 1) : DEFAULT_DETAIL_KEY;
}

const bound = new Map<string, ReportDef>();
const subs = new Set<() => void>();

/** Bind (or re-bind) the report a detail panel runs on viewport clicks. */
export function bindDetailReport(report: ReportDef, key: string = DEFAULT_DETAIL_KEY) {
  bound.set(key, report);
  for (const fn of subs) {
    fn();
  }
}

export function getDetailReport(key: string = DEFAULT_DETAIL_KEY): ReportDef | null {
  return bound.get(key) ?? null;
}

export function subscribeDetailReport(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}

/** App.tsx registers how to open a detail panel: the built-in one by id, a
 *  NAMED one by registering a panel definition for it first. */
type DetailOpener = (key: string, title: string) => void;
let opener: DetailOpener | null = null;

export function registerSqlDetailOpener(fn: DetailOpener | null) {
  opener = fn;
}

/** Open (or focus) a detail panel — the built-in one by default. */
export function openSqlDetailPanel(key: string = DEFAULT_DETAIL_KEY, title = 'SQL Detail') {
  opener?.(key, title);
}
