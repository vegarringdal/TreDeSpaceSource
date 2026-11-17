// Chunk-upload session registry for the postMessage API. Every session is
// owned by the window that began it and watched by a timer, so an owner that
// closes without `uploadAbort`, or a host that stops sending chunks, never
// leaves the import lock, the OPFS writable and the loading overlay stuck.
// Pure (no store / DOM imports) so the expiry rules are unit-testable — the
// side effects of an abort are the caller's `onExpire`.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** What the registry needs from an owner — a `Window` satisfies it. */
export interface UploadOwner {
  readonly closed: boolean;
}

export type ExpireReason = 'owner-gone' | 'idle';

export interface UploadRegistryOptions<T> {
  /** Expire a session after this long without a chunk. */
  idleMs: number;
  /** How often each session's owner and idle time are checked. */
  watchMs: number;
  /** Runs when the watchdog (or `dropOwner`) expires a session — it is
   *  already removed when this fires. */
  onExpire: (id: string, data: T, reason: ExpireReason) => void;
  /** Clock override for tests. */
  now?: () => number;
}

export interface UploadRegistry<T> {
  begin(id: string, owner: UploadOwner | null, data: T): void;
  /** The session, when `by` is its owner (or ownership is unknown). */
  get(id: string, by?: UploadOwner | null): T | undefined;
  /** A chunk arrived — restart the idle clock. */
  touch(id: string): void;
  /** Remove and stop watching; the caller finishes or aborts it itself. */
  take(id: string, by?: UploadOwner | null): T | undefined;
  /** Expire every session `owner` began (the client said bye or was pruned). */
  dropOwner(owner: UploadOwner): void;
  size(): number;
}

interface Session<T> {
  readonly owner: UploadOwner | null;
  readonly data: T;
  lastChunkAt: number;
  readonly timer: ReturnType<typeof setInterval>;
}

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

/** A session without an owner (no sender window) is open to any caller; an
 *  owned one answers only its owner — another window asking for it sees
 *  "not found", the same as a guessed id. */
export function createUploadRegistry<T>(opts: UploadRegistryOptions<T>): UploadRegistry<T> {
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, Session<T>>();
  const owns = (s: Session<T>, by: UploadOwner | null | undefined) => !s.owner || !by || s.owner === by;

  const expire = (id: string, reason: ExpireReason) => {
    const s = sessions.get(id);
    if (!s) {
      return;
    }
    sessions.delete(id);
    clearInterval(s.timer);
    opts.onExpire(id, s.data, reason);
  };

  const check = (id: string) => {
    const s = sessions.get(id);
    if (!s) {
      return;
    }
    if (s.owner?.closed) {
      expire(id, 'owner-gone');
    } else if (now() - s.lastChunkAt >= opts.idleMs) {
      expire(id, 'idle');
    }
  };

  return {
    begin(id, owner, data) {
      sessions.set(id, { owner, data, lastChunkAt: now(), timer: setInterval(() => check(id), opts.watchMs) });
    },
    get(id, by) {
      const s = sessions.get(id);
      return s && owns(s, by) ? s.data : undefined;
    },
    touch(id) {
      const s = sessions.get(id);
      if (s) {
        s.lastChunkAt = now();
      }
    },
    take(id, by) {
      const s = sessions.get(id);
      if (!s || !owns(s, by)) {
        return undefined;
      }
      sessions.delete(id);
      clearInterval(s.timer);
      return s.data;
    },
    dropOwner(owner) {
      for (const [id, s] of [...sessions]) {
        if (s.owner === owner) {
          expire(id, 'owner-gone');
        }
      }
    },
    size: () => sessions.size,
  };
}
