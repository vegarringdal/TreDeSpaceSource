// How safe and how full the browser's storage is. Everything a user imports
// lives in OPFS, which a browser may clear under disk pressure unless the
// origin was granted persistent storage, and which has a quota a multi-GB
// cook only hits after the user has waited through it. No store imports — the
// arithmetic is unit-tested.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface StorageStatus {
  /** The browser promised not to clear this origin's storage by itself. */
  readonly isPersistent: boolean;
  /** Bytes this origin uses, as the browser estimates them. */
  readonly usage: number;
  /** Bytes this origin may use at most. */
  readonly quota: number;
}

export type SpaceVerdict = Readonly<{ fits: true }> | Readonly<{ fits: false; needed: number; free: number }>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** A staged import holds a copy of its source in OPFS while it converts. */
const STAGED_COPIES = 2;

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;
const BYTE_STEP = 1024;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/**
 * Bytes an import of this source should find free. A rough floor, not a
 * promise: what a conversion produces is about the size of what it reads for
 * scans and often smaller for models. `isStaged` = the source is first copied
 * into OPFS, so the import needs room for that copy on top.
 */
export function importSpaceNeeded(sourceBytes: number, isStaged: boolean): number {
  return sourceBytes * (isStaged ? STAGED_COPIES : 1);
}

/** Whether `needed` bytes fit in what the quota leaves. */
export function judgeSpace(status: Pick<StorageStatus, 'usage' | 'quota'>, needed: number): SpaceVerdict {
  const free = Math.max(0, status.quota - status.usage);
  if (needed <= free) {
    return { fits: true };
  }

  return { fits: false, needed, free };
}

/** A byte count for people: "1.4 GB", "512 MB", "0 B". */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= BYTE_STEP && unit < BYTE_UNITS.length - 1) {
    value /= BYTE_STEP;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;

  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** The storage manager, or null where the browser has none (an insecure
 *  context, an old browser). */
function storageManager(): StorageManager | null {
  return typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null;
}

/** What the browser reports about this origin's storage, or null when it
 *  cannot say. */
export async function readStorageStatus(): Promise<StorageStatus | null> {
  const storage = storageManager();
  if (!storage?.estimate || !storage.persisted) {
    return null;
  }

  try {
    const [isPersistent, estimate] = await Promise.all([storage.persisted(), storage.estimate()]);

    return { isPersistent, usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Ask the browser to keep this origin's storage. Chrome decides by itself
 * (site engagement, an installed app, a bookmark) and shows nothing; Firefox
 * asks the user. Returns whether storage is persistent afterwards.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = storageManager();
  if (!storage?.persist) {
    return false;
  }

  try {
    return (await storage.persisted()) || (await storage.persist());
  } catch {
    return false;
  }
}
