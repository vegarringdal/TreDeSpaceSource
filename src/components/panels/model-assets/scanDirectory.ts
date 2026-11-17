import type { TreeDir, TreeNode } from '@treDeSpaceUI/widgets';

/** The importable file types shown in asset trees (.tdp = cooked TreDeSpace). */
export const IMPORTABLE = /\.(glb|tdp)$/i;

/** Cooked TreDeSpace files only — the Import TDP section. */
export const TDP_ONLY = /\.tdp$/i;

/** Empty-state line for trees filtered through IMPORTABLE. */
export const NO_IMPORTABLE_FILES = 'No importable files (.glb / .tdp) found.';

/** Empty-state line for TDP_ONLY trees. */
export const NO_TDP_FILES = 'No .tdp files found.';

export interface ScanOptions {
  /** File filter (default IMPORTABLE). */
  pattern?: RegExp;
  /** Descend into subdirectories (default true). */
  recurse?: boolean;
}

/** Scan a directory into a FileTree, keeping only files matching the pattern
 *  and skipping dot-dirs. `recurse: false` lists the top level only. */
export async function scanDirectory(
  dir: FileSystemDirectoryHandle,
  path = '',
  opts: ScanOptions = {},
): Promise<TreeDir> {
  const pattern = opts.pattern ?? IMPORTABLE;
  const recurse = opts.recurse ?? true;
  const children: TreeNode[] = [];
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.')) {
      continue; // hidden dirs/files
    }
    const childPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      if (!recurse) {
        continue;
      }
      const sub = await scanDirectory(entry, childPath, opts);
      if (sub.children.length > 0) {
        children.push(sub);
      }
    } else if (pattern.test(entry.name)) {
      children.push({ kind: 'file', name: entry.name, path: childPath, handle: entry });
    }
  }
  children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  return { kind: 'dir', name: dir.name, path, children };
}
