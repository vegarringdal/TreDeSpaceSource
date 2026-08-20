// Opener + report binding for the dockable SQL Detail panel. Clicking a
// report's Detail button binds that report here and opens the panel; the panel
// then follows viewport clicks.
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerSqlDetailOpener = opener.register;
export const openSqlDetailPanel = opener.call;

let bound: ReportDef | null = null;
const subs = new Set<() => void>();

export function bindDetailReport(report: ReportDef) {
  bound = report;
  for (const fn of subs) {
    fn();
  }
}
export function getDetailReport(): ReportDef | null {
  return bound;
}
export function subscribeDetailReport(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}
