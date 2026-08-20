// Origin-private file system (OPFS) helpers. Layout:
//   stores.json      the shared store registry (name + description), used by
//                    BOTH the Model Assets and SQL Assets panels.
//   model_assets/    the user's imported model assets + index.json (persistent).
//                    Files live in a REAL per-store directory
//                    (model_assets/<store>/<id>.tdp); the folder tree inside
//                    a store stays virtual (index.json).
//   sql_assets/      SQLite databases, one real directory per store
//                    (sql_assets/<store>/<file>.db) so ATTACH DATABASE works
//                    against a plain path.
//   temp/            scratch space for tools (safe to clear any time)

async function dir(name: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

/** The OPFS root — where the shared `stores.json` registry lives. */
export const rootDir = () => navigator.storage.getDirectory();

export const modelAssetsDir = () => dir('model_assets');
export const sqlAssetsDir = () => dir('sql_assets');
export const tempDir = () => dir('temp');

/** The real directory holding one store's cooked models. */
export async function modelStoreDir(store: string): Promise<FileSystemDirectoryHandle> {
  return (await modelAssetsDir()).getDirectoryHandle(store, { create: true });
}

/** The real directory holding one store's SQLite databases. */
export async function sqlStoreDir(store: string): Promise<FileSystemDirectoryHandle> {
  return (await sqlAssetsDir()).getDirectoryHandle(store, { create: true });
}

/** The canonical OPFS path of a database — what SQL uses in ATTACH DATABASE
 *  AND what import/delete/query all take their Web Lock on. */
export const sqlDbPath = (store: string, fileName: string) => `sql_assets/${store}/${fileName}`;

/** Remove a store's directories (models + databases). Missing dirs are fine. */
export async function removeStoreDirs(store: string) {
  for (const parent of [await modelAssetsDir(), await sqlAssetsDir()]) {
    try {
      await parent.removeEntry(store, { recursive: true });
    } catch {
      // never existed — fine
    }
  }
}

/** One-time migration (app ≤ 0.0.16): drop the pre-store `manual_assets/`
 *  folder. Its contents are NOT carried over — a clean start on the new store
 *  layout. No-op once it's gone. */
export async function deleteLegacyManualAssets() {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('manual_assets', { recursive: true });
  } catch {
    // already gone (the common case) — fine
  }
}

const LAYOUT_KEY = 'opfsLayout';
const LAYOUT_VERSION = 'v2';

/** One-time migration (app ≤ 0.0.18): the model library used to be FLAT
 *  (`model_assets/<id>.tdp` with the store as a tag). Stores are real
 *  directories now, and by the director's call there is no carry-over: the
 *  whole folder goes once, index.json included. No-op after the first run. */
export async function wipeLegacyFlatAssets() {
  if (localStorage.getItem(LAYOUT_KEY) === LAYOUT_VERSION) {
    return;
  }
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('model_assets', { recursive: true });
  } catch {
    // nothing to wipe (fresh install) — fine
  }
  localStorage.setItem(LAYOUT_KEY, LAYOUT_VERSION);
}

/** temp/rvm-import — staging area for RVM imports (input copy + merged GLBs). */
export async function rvmTempDir(): Promise<FileSystemDirectoryHandle> {
  return (await tempDir()).getDirectoryHandle('rvm-import', { create: true });
}

/** Scratch dir for Export-panel output: workers stream results here, the main
 *  thread downloads the finished file, then deletes it. */
export async function exportTempDir(): Promise<FileSystemDirectoryHandle> {
  return (await tempDir()).getDirectoryHandle('export', { create: true });
}

/** temp/uploads — staging for chunk-uploaded imports (one `<id>.part` per
 *  in-flight upload; reassembled here before the normal import runs). */
export async function uploadsTempDir(): Promise<FileSystemDirectoryHandle> {
  return (await tempDir()).getDirectoryHandle('uploads', { create: true });
}

/** List the FILES directly in a directory (subdirectories are skipped). */
export async function listFiles(parent: FileSystemDirectoryHandle): Promise<File[]> {
  const out: File[] = [];
  for await (const [, handle] of parent.entries()) {
    if (handle.kind !== 'file') {
      continue;
    }
    out.push(await handle.getFile());
  }
  return out;
}

/** Delete every entry in a directory (files and subtrees). */
export async function clearDir(parent: FileSystemDirectoryHandle) {
  const names: string[] = [];
  for await (const name of parent.keys()) {
    names.push(name);
  }
  for (const name of names) {
    await parent.removeEntry(name, { recursive: true });
  }
}

export async function writeFile(parent: FileSystemDirectoryHandle, name: string, data: ArrayBuffer | Blob) {
  const handle = await parent.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}

export async function readFile(parent: FileSystemDirectoryHandle, name: string): Promise<ArrayBuffer> {
  const handle = await parent.getFileHandle(name);
  return (await handle.getFile()).arrayBuffer();
}

export async function deleteFile(parent: FileSystemDirectoryHandle, name: string) {
  try {
    await parent.removeEntry(name);
  } catch {
    // already gone — fine
  }
}

export async function readJson<T>(parent: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  try {
    const handle = await parent.getFileHandle(name);
    return JSON.parse(await (await handle.getFile()).text()) as T;
  } catch {
    return null;
  }
}

export async function writeJson(parent: FileSystemDirectoryHandle, name: string, value: unknown) {
  await writeFile(parent, name, new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
}
