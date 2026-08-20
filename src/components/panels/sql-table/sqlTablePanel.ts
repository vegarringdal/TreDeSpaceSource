// Opener + result feed for the dockable SQL Table panel. A report run pushes
// its result here and opens the panel; the grid renders whatever is current.
import { makeCallbackSlot } from '../panelRegistry';

const opener = makeCallbackSlot();
export const registerSqlTableOpener = opener.register;
export const openSqlTablePanel = opener.call;

/** A result set shown in the grid. `truncated` = the row cap clipped it, so
 *  the panel offers "Load all" (which re-runs `reload`). */
export interface TablePayload {
  title: string;
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  /** Re-run at the 250k cap (TABLE reports); null when there's nothing more. */
  reload: (() => void) | null;
}

let payload: TablePayload | null = null;
const subs = new Set<() => void>();

export function setTablePayload(p: TablePayload) {
  payload = p;
  for (const fn of subs) {
    fn();
  }
}
export function getTablePayload(): TablePayload | null {
  return payload;
}
export function subscribeTablePayload(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}
