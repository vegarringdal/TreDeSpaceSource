import type { TreeDir } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { compileSearch } from '../../../lib/searchExpr';
import { type AssetEntry, assetsState } from '../../../state/assets/assets.state';
import { MAIN_STORE, storesState, TEMP_STORE } from '../../../state/stores/stores.state';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export type AssetsLibraryModel = Readonly<{
  query: string;
  setQuery: (query: string) => void;
  searching: boolean;
  totalAssets: number;
  visibleAssets: AssetEntry[];
  /** Ids of the selected VISIBLE assets (the filter applies). */
  visibleIds: string[];
  selCount: number;
  selectedSet: Set<string>;
  selectedOne: AssetEntry | undefined;
  setSelection: (next: Set<string>) => void;
  /** Store names in section order (registry order, temp last when present). */
  sectionStores: string[];
  /** Section paths that start collapsed (every store but "main"). */
  defaultCollapsed: string[];
  /** Remount key for the tree — collapse state re-derives when stores change. */
  treeKey: string;
  tree: TreeDir;
}>;

/** A tree row reference: which store, and the folder path inside it. */
export type DirRef = Readonly<{ store: string; path: string }>;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Parse a unified-tree dir path — `store:<name>` (section band) or
 *  `folder:<name>/<path>` — into its store + in-store folder path. */
export function parseDirRef(dirPath: string): DirRef | null {
  if (dirPath.startsWith('store:')) {
    return { store: dirPath.slice(6), path: '' };
  }
  if (dirPath.startsWith('folder:')) {
    const rest = dirPath.slice(7);
    const i = rest.indexOf('/');
    return i < 0 ? { store: rest, path: '' } : { store: rest.slice(0, i), path: rest.slice(i + 1) };
  }
  return null;
}

/** One store's subtree: folder paths ("A/B") become dirs-in-dirs (paths
 *  prefixed with the store), files keyed by asset id. */
function buildStoreChildren(store: string, storeAssets: AssetEntry[], extraFolders: string[]): TreeDir {
  const rootDir: TreeDir = { kind: 'dir', name: store, path: `store:${store}`, children: [] };
  const dirs = new Map<string, TreeDir>([['', rootDir]]);
  const ensureDir = (path: string): TreeDir => {
    const hit = dirs.get(path);
    if (hit) {
      return hit;
    }
    const segs = path.split('/');
    const parent = ensureDir(segs.slice(0, -1).join('/'));
    const dir: TreeDir = { kind: 'dir', name: segs[segs.length - 1], path: `folder:${store}/${path}`, children: [] };
    parent.children.push(dir);
    dirs.set(path, dir);
    return dir;
  };
  const folderPaths = [...new Set([...storeAssets.map((a) => a.folder), ...extraFolders])].filter(Boolean).sort();
  for (const f of folderPaths) {
    ensureDir(f);
  }
  for (const a of storeAssets) {
    ensureDir(a.folder || '').children.push({
      kind: 'file',
      name: a.name,
      path: a.id,
      note: `${(a.size / 1048576).toFixed(1)} MB`,
    });
  }
  const sortDir = (d: TreeDir) => {
    d.children.sort((x, y) => (x.kind === y.kind ? x.name.localeCompare(y.name) : x.kind === 'dir' ? -1 : 1));
    for (const c of d.children) {
      if (c.kind === 'dir') {
        sortDir(c);
      }
    }
  };
  sortDir(rootDir);
  return rootDir;
}

// -----------------------------------------------------------------------------
// hook
// -----------------------------------------------------------------------------

/** The unified Model Assets view: every store as a section band in ONE tree,
 *  one search and one global selection across all of them. */
export function useAssetsLibrary(exact: boolean): AssetsLibraryModel {
  const { assets, selected, extraFolders } = assetsState.use();
  const { stores } = storesState.use();
  const [query, setQuery] = useState('');

  const searching = query.trim().length > 0;
  const matcher = compileSearch(query, exact ? 'equals' : 'contains');
  const visibleAssets = searching ? assets.filter((a) => matcher([a.name, a.folder, a.store])) : assets;
  const visibleIds = visibleAssets.filter((a) => selected[a.id]).map((a) => a.id);
  const selCount = assets.filter((a) => selected[a.id]).length;
  const selectedSet = new Set(assets.filter((a) => selected[a.id]).map((a) => a.id));
  const selectedOne = selCount === 1 ? assets.find((a) => selected[a.id]) : undefined;

  // the tree spans every asset, so the tree's selection IS the global one
  const setSelection = (next: Set<string>) => {
    assetsState.set(() => ({ selected: Object.fromEntries([...next].map((id) => [id, true])) }));
  };

  const hasTemp = assets.some((a) => a.store === TEMP_STORE);
  const sectionStores = [...stores.map((s) => s.name), ...(hasTemp ? [TEMP_STORE] : [])];
  const tree: TreeDir = { kind: 'dir', name: '', path: '', children: [] };
  for (const store of sectionStores) {
    const storeAssets = visibleAssets.filter((a) => a.store === store);
    if (searching && storeAssets.length === 0) {
      continue; // hide stores with no hits while filtering
    }
    const section = buildStoreChildren(store, storeAssets, searching ? [] : (extraFolders[store] ?? []));
    section.variant = 'section';
    tree.children.push(section);
  }

  return {
    query,
    setQuery,
    searching,
    totalAssets: assets.length,
    visibleAssets,
    visibleIds,
    selCount,
    selectedSet,
    selectedOne,
    setSelection,
    sectionStores,
    defaultCollapsed: sectionStores.filter((s) => s !== MAIN_STORE).map((s) => `store:${s}`),
    treeKey: sectionStores.join('|'),
    tree,
  };
}
