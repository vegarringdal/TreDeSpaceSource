// A JSON document every open tab keeps a copy of (the asset index, the store
// registry, the overlay library). Each tab used to write its copy back whole,
// so the last tab to save dropped what the others had added. Here every save
// reads the file again and applies only what this tab changed, under a lock
// all tabs share. Pure — the lock, the file and the cross-tab note are
// injected (sharedJson.ts binds them to the browser) — so it is unit-tested.

/** The browser side of a shared document. */
export interface SharedDocIo<T> {
  /** Run `body` alone: no other tab reads or writes the document meanwhile. */
  lock<R>(body: () => Promise<R>): Promise<R>;
  /** The document on disk, or null when there is none yet. Throws when the
   *  file exists but cannot be read or parsed. */
  read(): Promise<T | null>;
  write(value: T): Promise<void>;
  /** Tell the other tabs the document changed. */
  notify(): void;
}

export interface SharedDocOptions<T> {
  io: SharedDocIo<T>;
  /** The document before anything was saved. */
  empty: T;
  /** Apply what `mine` changed since `base` to `theirs` (see keyedMerge.ts). */
  merge(base: T, mine: T, theirs: T): T;
  /** This tab's copy. */
  get(): T;
  /** Replace this tab's copy — only called when it would change. */
  set(value: T): void;
}

export interface SharedDoc<T> {
  /** Read the document and take it as this tab's starting point. The caller
   *  puts the result in its state. */
  load(): Promise<T>;
  /** Write this tab's changes into the document on disk and take over what
   *  the other tabs changed. */
  save(): Promise<void>;
  /** Take over what another tab wrote, keeping this tab's unsaved changes.
   *  Does nothing before {@link SharedDoc.load}. */
  refresh(): Promise<void>;
}

function sameDoc<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Bind a tab's copy of a document to the file all tabs share.
 *
 * The doc remembers `base`, the document as this tab last saw it on disk, so
 * a save can tell this tab's own changes (`get()` against `base`) from the
 * ones another tab made (disk against `base`). State that changed while a
 * write was in flight is merged the same way, so the later change is neither
 * lost nor written twice.
 */
export function createSharedDoc<T>(options: SharedDocOptions<T>): SharedDoc<T> {
  const { io, empty, merge, get, set } = options;
  let base = empty;
  let isLoaded = false;

  /** The document on disk; `fallback` when it cannot be read, so a save
   *  during a failed read writes this tab's copy instead of an empty one. */
  async function readOr(fallback: T): Promise<T> {
    try {
      return (await io.read()) ?? empty;
    } catch {
      return fallback;
    }
  }

  function adopt(next: T): void {
    if (!sameDoc(next, get())) {
      set(next);
    }
  }

  return {
    load() {
      return io.lock(async () => {
        base = await readOr(empty);
        isLoaded = true;

        return base;
      });
    },

    save() {
      return io.lock(async () => {
        const theirs = await readOr(base);
        const mine = get();
        const merged = merge(base, mine, theirs);
        const hasChanged = !sameDoc(merged, theirs);
        if (hasChanged) {
          await io.write(merged);
        }
        base = merged;
        const now = get();
        adopt(now === mine ? merged : merge(mine, now, merged));
        if (hasChanged) {
          io.notify();
        }
      });
    },

    refresh() {
      return io.lock(async () => {
        if (!isLoaded) {
          return;
        }

        const theirs = await readOr(base);
        const next = merge(base, get(), theirs);
        base = theirs;
        adopt(next);
      });
    },
  };
}
