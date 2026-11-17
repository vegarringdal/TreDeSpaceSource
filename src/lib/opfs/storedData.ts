// Whether this storage holds anything a stranger should not read: imported
// models, scans or SQL databases. Read straight from OPFS, without loading
// the asset index into state — the answer is needed at boot, before any panel.

/** The directories user data lives in: `<root>/<store>/<file>`. */
const USER_DATA_ROOTS = ['model_assets', 'sql_assets'] as const;
/** The app's own bookkeeping next to the data (index, sidecars). */
const SIDECAR_SUFFIX = '.json';
const NOT_FOUND = 'NotFoundError';

async function holdsDataFile(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && !entry.name.endsWith(SIDECAR_SUFFIX)) {
      return true;
    }

    if (entry.kind === 'directory' && (await holdsDataFile(await dir.getDirectoryHandle(entry.name)))) {
      return true;
    }
  }

  return false;
}

/**
 * True when the viewer's storage holds a model, a scan or a database. A
 * storage that cannot be read counts as holding data: the caller decides
 * whether to trust a page without asking, and must not do so on a guess.
 */
export async function holdsUserData(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    for (const name of USER_DATA_ROOTS) {
      let dir: FileSystemDirectoryHandle;
      try {
        dir = await root.getDirectoryHandle(name);
      } catch (e) {
        if (e instanceof DOMException && e.name === NOT_FOUND) {
          continue;
        }
        throw e;
      }

      if (await holdsDataFile(dir)) {
        return true;
      }
    }

    return false;
  } catch {
    return true;
  }
}
