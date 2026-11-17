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

/** A panel's binding: the report it runs, whether it follows clicks
 *  (Listening) or holds its row (Paused), and whether closing the panel
 *  throws it away (the default) or keeps it for when the panel is reopened. */
type DetailEntry = { report: ReportDef; listening: boolean; autoRemove: boolean };

const bound = new Map<string, DetailEntry>();
const subs = new Set<() => void>();

function notify() {
  for (const fn of subs) {
    fn();
  }
}

/** Bind (or re-bind) the report a detail panel runs on viewport clicks. */
export function bindDetailReport(report: ReportDef, key: string = DEFAULT_DETAIL_KEY, autoRemove?: boolean) {
  const prev = bound.get(key);
  bound.set(key, {
    report,
    listening: prev?.listening ?? true,
    autoRemove: autoRemove ?? prev?.autoRemove ?? true,
  });
  notify();
}

export function getDetailReport(key: string = DEFAULT_DETAIL_KEY): ReportDef | null {
  return bound.get(key)?.report ?? null;
}

/** Whether the panel follows clicks (true until paused; a panel with no
 *  report has nothing to follow). */
export function getDetailListening(key: string): boolean {
  return bound.get(key)?.listening ?? true;
}

export function setDetailListening(key: string, on: boolean) {
  const entry = bound.get(key);
  if (!entry || entry.listening === on) {
    return;
  }
  bound.set(key, { ...entry, listening: on });
  notify();
}

/** Hotkey: pause every detail panel if any is listening, else resume all —
 *  one key serves the built-in panel and however many named ones exist. */
export function toggleAllDetailListening() {
  const anyListening = [...bound.values()].some((e) => e.listening);
  for (const [key, entry] of bound) {
    bound.set(key, { ...entry, listening: !anyListening });
  }
  if (bound.size) {
    notify();
  }
}

/** Whether closing this panel removes it completely. Only named panels are
 *  ever removed — the built-in one always stays. */
export function getDetailAutoRemove(key: string): boolean {
  return bound.get(key)?.autoRemove ?? true;
}

export function setDetailAutoRemove(key: string, on: boolean) {
  const entry = bound.get(key);
  if (!entry || entry.autoRemove === on) {
    return;
  }
  bound.set(key, { ...entry, autoRemove: on });
  notify();
}

/** Drop a named panel's binding (its panel definition is unregistered by the
 *  app's opener). The built-in panel keeps its binding. */
export function removeDetailBinding(key: string) {
  if (!key || !bound.delete(key)) {
    return;
  }
  notify();
}

export function subscribeDetailReport(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}

/** App.tsx registers how to open a detail panel: the built-in one by id, a
 *  NAMED one by registering a panel definition for it first (that definition
 *  carries the onClose that honours {@link getDetailAutoRemove}). */
type DetailOpener = (key: string, title: string) => void;
let opener: DetailOpener | null = null;

export function registerSqlDetailOpener(fn: DetailOpener | null) {
  opener = fn;
}

/** Open (or focus) a detail panel — the built-in one by default. */
export function openSqlDetailPanel(key: string = DEFAULT_DETAIL_KEY, title = 'SQL Detail') {
  opener?.(key, title);
}
