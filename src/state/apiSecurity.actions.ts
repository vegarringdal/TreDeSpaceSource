// Mutation for the postMessage API security settings (apiSecurity.state.ts).
// The consent prompt for a `?apiOrigins=` popup host lands here; the Settings
// section still edits the store directly (pre-dates this module).
import { apiSecurityState } from './apiSecurity.state';

/** scheme + host only — no path, no trailing slash */
function normalizeOrigin(o: string): string {
  return o.trim().replace(/\/+$/, '');
}

export const apiSecurityActions = {
  /** Add origins to the persisted allowlist (Settings → External → API
   *  security). Deduped against the list and each other; blanks and `*` are
   *  never added this way. */
  addOrigins(origins: readonly string[]): void {
    const cur = apiSecurityState.get().origins;
    const add = origins
      .map(normalizeOrigin)
      .filter((o, i, arr) => o !== '' && o !== '*' && !cur.includes(o) && arr.indexOf(o) === i);
    if (!add.length) {
      return;
    }
    apiSecurityState.set({ origins: [...cur, ...add] });
  },
};
