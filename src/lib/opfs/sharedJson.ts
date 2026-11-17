// Browser binding for sharedDoc.ts: the document is a JSON file in OPFS, the
// lock is a Web Lock and the cross-tab note travels on a BroadcastChannel.
// Web Locks, BroadcastChannel and OPFS are all partitioned the same way, so
// exactly the tabs that share the file share the lock and the note.

import { STORAGE_PREFIX } from '../storageKeys';
import { writeJson } from './opfs';
import { createSharedDoc, type SharedDoc, type SharedDocIo } from './sharedDoc';

export interface SharedJsonOptions<T> {
  /** Names the lock and the channel — unique per document. */
  name: string;
  dir(): Promise<FileSystemDirectoryHandle>;
  file: string;
  /** Turn the parsed file (any older layout included) into the document. */
  parse(raw: unknown): T;
  empty: T;
  merge(base: T, mine: T, theirs: T): T;
  get(): T;
  set(value: T): void;
}

const NOT_FOUND = 'NotFoundError';

/** Run `body` while holding the Web Lock that guards one shared JSON file —
 *  for the files that are edited on disk directly, with no copy in a store. */
export function withJsonLock<R>(name: string, body: () => Promise<R>): Promise<R> {
  return navigator.locks.request(`${STORAGE_PREFIX}doc:${name}`, body);
}

function jsonIo<T>(options: SharedJsonOptions<T>, channel: BroadcastChannel): SharedDocIo<T> {
  return {
    lock: (body) => withJsonLock(options.name, body),

    async read() {
      const dir = await options.dir();
      let text: string;
      try {
        text = await (await (await dir.getFileHandle(options.file)).getFile()).text();
      } catch (e) {
        if (e instanceof DOMException && e.name === NOT_FOUND) {
          return null;
        }
        throw e;
      }

      return options.parse(JSON.parse(text));
    },

    async write(value) {
      await writeJson(await options.dir(), options.file, value);
    },

    notify() {
      channel.postMessage(null);
    },
  };
}

/**
 * A JSON file in OPFS that every tab may edit: saves merge instead of
 * overwriting, and a save in one tab refreshes the copy in the others.
 */
export function createSharedJson<T>(options: SharedJsonOptions<T>): SharedDoc<T> {
  const channel = new BroadcastChannel(`${STORAGE_PREFIX}doc:${options.name}`);
  const doc = createSharedDoc<T>({
    io: jsonIo(options, channel),
    empty: options.empty,
    merge: options.merge,
    get: options.get,
    set: options.set,
  });
  channel.addEventListener('message', () => void doc.refresh().catch(() => undefined));

  return doc;
}
