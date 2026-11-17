// This tab's identity for the session, visible to the other tabs through a
// Web Lock it holds until the page goes away: a crash, a reload and a close
// all release it, with nothing to clean up. Session-only data (temp imports)
// is tagged with the id, and a starting tab asks which ids are still alive
// before it clears anything.

import { STORAGE_PREFIX } from './storageKeys';

const TAB_LOCK_PREFIX = `${STORAGE_PREFIX}tab:`;

/** This tab's id — new on every page load. */
export const TAB_ID: string = crypto.randomUUID();

let held: Promise<void> | null = null;

/** Take this tab's lock and keep it for the life of the page. Resolves once
 *  the lock is held, so other tabs can already see this one. */
export function holdTabLock(): Promise<void> {
  held ??= new Promise<void>((resolve) => {
    void navigator.locks.request(`${TAB_LOCK_PREFIX}${TAB_ID}`, () => {
      resolve();

      return new Promise<never>(() => undefined);
    });
  });

  return held;
}

/** The ids of every tab that is open right now, this one included. */
export async function liveTabIds(): Promise<Set<string>> {
  await holdTabLock();
  const { held: locks = [] } = await navigator.locks.query();
  const ids = new Set<string>();
  for (const lock of locks) {
    if (lock.name?.startsWith(TAB_LOCK_PREFIX)) {
      ids.add(lock.name.slice(TAB_LOCK_PREFIX.length));
    }
  }

  return ids;
}
