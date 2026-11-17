// Pages that asked to be told before their dialog / panel is unmounted
// (`ui.dialog.holdClose`), and the closes currently waiting on one. Not a
// store — nothing renders from it: the modal store and the dock manager hide
// the entry the moment a held close starts and unmount it when the page
// releases the hold (`ui.dialog.releaseClose`) or the timeout passes. Keyed by
// the dialog / panel id the API addresses. Pure, so it is unit-tested as is.

export const DEFAULT_CLOSE_HOLD_MS = 3000;
export const MAX_CLOSE_HOLD_MS = 10_000;

const holds = new Map<string, number>();
const pending = new Map<string, () => void>();

/** Ask (or stop asking) to be told before `id` is unmounted. `timeoutMs` caps
 *  how long a close waits for the release, clamped to [0, MAX]. Returns the
 *  timeout in force, or null once the hold is off. */
export function setCloseHold(id: string, hold: boolean, timeoutMs = DEFAULT_CLOSE_HOLD_MS): number | null {
  if (!hold) {
    holds.delete(id);
    return null;
  }
  const ms = Math.min(MAX_CLOSE_HOLD_MS, Math.max(0, Math.round(timeoutMs)));
  holds.set(id, ms);
  return ms;
}

export function hasCloseHold(id: string): boolean {
  return holds.has(id);
}

/** Start a held close of `id`: resolves when its page releases the hold or
 *  the timeout passes. Null when the page never asked — close at once.
 *  Callers guard against starting a second wait for the same id. */
export function beginHeldClose(id: string): Promise<void> | null {
  const timeoutMs = holds.get(id);
  if (timeoutMs === undefined) {
    return null;
  }
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pending.delete(id);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    pending.set(id, done);
  });
}

/** The page is done (`ui.dialog.releaseClose`): finish the waiting close now.
 *  False when nothing was waiting. */
export function releaseHeldClose(id: string): boolean {
  const done = pending.get(id);
  if (!done) {
    return false;
  }
  done();
  return true;
}

/** The page is gone: forget its hold — a later page under the same id (a
 *  reopened single-instance panel) starts without one — and finish any wait. */
export function clearCloseHold(id: string): void {
  holds.delete(id);
  pending.get(id)?.();
}
