import type { TreeDir, TreeFile } from '@treDeSpaceUI/widgets';
import { scanDirectory, TDP_ONLY } from '../model-assets/scanDirectory';

/** Staging: either a scanned directory tree (tree multi-select) or a flat
 *  list of individually picked files, tagged with the section that staged it. */
export interface Staged {
  tree: TreeDir | null;
  files: TreeFile[]; // flat picks (from the file picker)
  defaultName: string;
  kind: 'glb' | 'tdp';
}

/** Pick + scan a folder into a tree (dot-dirs are skipped). */
export async function pickFolder(): Promise<Staged | null> {
  try {
    const dir = await (
      window as unknown as { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker();
    const tree = await scanDirectory(dir);
    return { tree, files: [], defaultName: dir.name, kind: 'glb' };
  } catch {
    return null;
  }
}

/** Pick individual .tdp files — File System Access picker, so each file keeps
 *  a handle the import can stream from. */
export async function pickTdpFiles(): Promise<Staged | null> {
  try {
    const handles = await (
      window as unknown as { showOpenFilePicker(o: object): Promise<FileSystemFileHandle[]> }
    ).showOpenFilePicker({
      multiple: true,
      types: [{ description: 'TreDeSpace models', accept: { 'application/octet-stream': ['.tdp'] } }],
    });
    if (handles.length === 0) {
      return null;
    }
    const files: TreeFile[] = handles.map((h) => ({ kind: 'file', name: h.name, path: h.name, handle: h }));
    return { tree: null, files, defaultName: 'misc', kind: 'tdp' };
  } catch {
    return null;
  }
}

/** Pick a folder of .tdp files — top level only, or the whole subtree. */
export async function pickTdpFolder(recurse: boolean): Promise<Staged | null> {
  try {
    const dir = await (
      window as unknown as { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker();
    const tree = await scanDirectory(dir, '', { pattern: TDP_ONLY, recurse });
    return { tree, files: [], defaultName: dir.name, kind: 'tdp' };
  } catch {
    return null;
  }
}

/** Every file path in a staged tree/pick list (for select-all). */
export function allStagedPaths(staged: Staged | null): string[] {
  if (!staged) {
    return [];
  }

  if (staged.tree) {
    const out: string[] = [];
    const walk = (n: TreeDir | TreeFile) => {
      if (n.kind === 'file') {
        out.push(n.path);
      } else {
        for (const c of n.children) {
          walk(c);
        }
      }
    };
    walk(staged.tree);
    return out;
  }

  return staged.files.map((f) => f.path);
}

/** Every staged file matching the selection set. */
export function selectedStagedFiles(staged: Staged | null, sel: ReadonlySet<string>): TreeFile[] {
  if (!staged) {
    return [];
  }

  if (staged.tree) {
    const out: TreeFile[] = [];
    const walk = (n: TreeDir | TreeFile) => {
      if (n.kind === 'file') {
        if (sel.has(n.path)) {
          out.push(n);
        }
      } else {
        for (const c of n.children) {
          walk(c);
        }
      }
    };
    walk(staged.tree);
    return out;
  }

  return staged.files.filter((f) => sel.has(f.path));
}
