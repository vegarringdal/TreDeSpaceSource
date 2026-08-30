import type { TreeNode } from '../../../lib/modeldb/modeldbWorker';
import { db } from '../../../state/viewer/db';
import { groupSelKey, selectionState } from '../../../state/viewer/selection.state';

export interface Row {
  model: number; // -1 = a folder-group row (or a store band, see `store`)
  entry: number;
  depth: number;
  name: string;
  hasChildren: boolean;
  group?: string;
  /** row is a NON-INTERACTIVE store (plant) band — pure grouping chrome: not
   *  collapsible, not selectable, and it does NOT add a hierarchy level (the
   *  Set Color level filters keep counting folders/entries only). */
  store?: string;
  /** plant context of a folder row rendered under a store band — group
   *  operations (select/toggle/remove/expand) scope to this store only. */
  inStore?: string;
  /** row is a model file's ROOT entry (gets the mesh icon at any depth) */
  isRoot?: boolean;
  /** highlighted: the active selection root / under it, OR every item
   *  beneath the row is selected (derived from item state, so invert, API
   *  and SQL selections show at every level without expanding) */
  selected: boolean;
  /** some but not all items beneath the row are selected */
  partial?: boolean;
  /** every item beneath this row is hidden ('all'), or only some ('some') */
  hidden?: 'all' | 'some';
}

type Agg = { itemsUnder: number; hiddenUnder: number; selectedUnder: number };

/** Selection state of a node from its subtree counts. */
function selectedOf(n: Agg): { all: boolean; partial: boolean } {
  const all = n.selectedUnder > 0 && n.selectedUnder >= n.itemsUnder;
  return { all, partial: n.selectedUnder > 0 && !all };
}

/** The visibility badge for a node from its subtree counts. */
function hiddenOf(n: { itemsUnder: number; hiddenUnder: number }): 'all' | 'some' | undefined {
  if (n.hiddenUnder === 0) {
    return undefined;
  }
  return n.hiddenUnder >= n.itemsUnder ? 'all' : 'some';
}

/** Worker-fetched data cached across rebuilds (cleared on model changes). */
export interface HierarchyCaches {
  children: Map<string, TreeNode[]>;
  groups: { group: string; models: number[] }[];
  groupRoots: Map<string, { model: number; node: TreeNode }[]>;
  modelGroup: Map<number, string>;
  /** loaded worker model index → store (plant) name, resolved via assets. */
  modelStore: Map<number, string>;
  /** store display order (registry order, temp last). */
  storeOrder: string[];
}

export const keyOf = (model: number, entry: number) => `${model}:${entry}`;
/** Expansion key for a folder row; store-qualified under a plant band so the
 *  same folder path expands independently per plant. */
export const groupKey = (group: string, store?: string) => (store ? `g:${store}\0${group}` : `g:${group}`);

/**
 * Build the visible row list: the import folders as a nested tree (group names
 * are asset folder PATHS "A/B"), model roots under their group, and expanded
 * entries' children fetched from the worker on demand (cached in `caches`).
 * Selection highlighting cascades down open subtrees.
 */
export async function buildRows(caches: HierarchyCaches, exp: Set<string>): Promise<Row[]> {
  const { actives, activeGroup, activeGroups } = selectionState.get();
  const activeSet = new Set(actives);
  const activeGroupSet = new Set(activeGroups);
  const out: Row[] = [];

  const walk = async (model: number, nodes: TreeNode[], depth: number, underActive: boolean) => {
    for (const n of nodes) {
      const isActive = underActive || activeSet.has(keyOf(model, n.entry));
      const sel = selectedOf(n);
      out.push({
        model,
        entry: n.entry,
        depth,
        name: n.name,
        hasChildren: n.hasChildren,
        selected: isActive || sel.all,
        partial: !isActive && sel.partial,
        hidden: hiddenOf(n),
      });
      if (n.hasChildren && exp.has(keyOf(model, n.entry))) {
        const k = keyOf(model, n.entry);
        let kids = caches.children.get(k);
        if (!kids) {
          kids = await db.children(model, n.entry);
          caches.children.set(k, kids);
        }
        await walk(model, kids, depth + 1, isActive);
      }
    }
  };

  interface GNode {
    seg: string;
    path: string;
    isGroup: boolean; // an actual import group lives at exactly this path
    kids: Map<string, GNode>;
  }
  /** The group-folder tree, optionally restricted to one store's models. */
  const buildTop = (onlyStore: string | null): Map<string, GNode> => {
    const top = new Map<string, GNode>();
    for (const g of caches.groups) {
      if (onlyStore != null && !g.models.some((m) => caches.modelStore.get(m) === onlyStore)) {
        continue;
      }
      const segs = g.group.split('/');
      let level = top;
      let path = '';
      for (let i = 0; i < segs.length; i++) {
        path = path ? `${path}/${segs[i]}` : segs[i];
        let node = level.get(segs[i]);
        if (!node) {
          node = { seg: segs[i], path, isGroup: false, kids: new Map() };
          level.set(segs[i], node);
        }
        if (i === segs.length - 1) {
          node.isGroup = true;
        }
        level = node.kids;
      }
    }
    return top;
  };

  let onlyStore: string | null = null;
  /** Model roots of one import group (cached until the next state change),
   *  narrowed to the current store band. */
  const rootsOf = async (path: string) => {
    let roots = caches.groupRoots.get(path);
    if (!roots) {
      roots = await db.groupRoots(path);
      caches.groupRoots.set(path, roots);
    }
    if (onlyStore != null) {
      roots = roots.filter((r) => caches.modelStore.get(r.model) === onlyStore);
    }
    return roots;
  };
  /** Subtree totals for a folder row ('' = the whole store band): the item /
   *  hidden / selected counts of every model root at or below that folder
   *  path, so a collapsed folder or store still shows what is hidden or
   *  selected under it. */
  const groupAgg = async (path: string): Promise<Agg> => {
    const agg: Agg = { itemsUnder: 0, hiddenUnder: 0, selectedUnder: 0 };
    for (const g of caches.groups) {
      if (path !== '' && g.group !== path && !g.group.startsWith(`${path}/`)) {
        continue;
      }
      for (const r of await rootsOf(g.group)) {
        agg.itemsUnder += r.node.itemsUnder;
        agg.hiddenUnder += r.node.hiddenUnder;
        agg.selectedUnder += r.node.selectedUnder;
      }
    }
    return agg;
  };
  const emitGroupRoots = async (path: string, depth: number, groupActive: boolean) => {
    const roots = await rootsOf(path);
    for (const r of roots) {
      const rootActive = groupActive || activeSet.has(keyOf(r.model, r.node.entry));
      const sel = selectedOf(r.node);
      out.push({
        model: r.model,
        entry: r.node.entry,
        depth,
        name: r.node.name,
        hasChildren: r.node.hasChildren,
        isRoot: true,
        selected: rootActive || sel.all,
        partial: !rootActive && sel.partial,
        hidden: hiddenOf(r.node),
      });
      if (exp.has(keyOf(r.model, r.node.entry))) {
        const k = keyOf(r.model, r.node.entry);
        let kids = caches.children.get(k);
        if (!kids) {
          kids = await db.children(r.model, r.node.entry);
          caches.children.set(k, kids);
        }
        await walk(r.model, kids, depth + 1, rootActive);
      }
    }
  };

  const walkGroups = async (level: Map<string, GNode>, depth: number, underActive: boolean) => {
    for (const node of [...level.values()].sort((a, b) => a.seg.localeCompare(b.seg))) {
      // selecting a folder highlights it AND every open descendant folder.
      // Qualified keys come from band-scoped clicks (this plant only);
      // unqualified ones from search/API picks (match in every plant).
      const qualified = onlyStore != null ? groupSelKey(node.path, onlyStore) : null;
      const groupActive =
        underActive ||
        activeGroup === node.path ||
        (qualified != null && activeGroup === qualified) ||
        activeGroupSet.has(node.path) ||
        (qualified != null && activeGroupSet.has(qualified));
      const agg = await groupAgg(node.path);
      const sel = selectedOf(agg);
      out.push({
        model: -1,
        entry: -1,
        depth,
        name: node.seg,
        hasChildren: true,
        group: node.path,
        inStore: onlyStore ?? undefined,
        selected: groupActive || sel.all,
        partial: !groupActive && sel.partial,
        hidden: hiddenOf(agg),
      });
      if (exp.has(groupKey(node.path)) || (onlyStore != null && exp.has(groupKey(node.path, onlyStore)))) {
        if (node.isGroup) {
          await emitGroupRoots(node.path, depth + 1, groupActive);
        }
        await walkGroups(node.kids, depth + 1, groupActive);
      }
    }
  };

  // store (plant) bands whenever the mapping is complete — even a single
  // plant gets its band. A band is chrome ONLY — content keeps depth 0 so
  // hierarchy levels (Set Color's level filters) are identical with and
  // without bands.
  const loadedStores = caches.storeOrder.filter((s) =>
    caches.groups.some((g) => g.models.some((m) => caches.modelStore.get(m) === s)),
  );
  // a model whose store could not be resolved must never vanish from the
  // tree — without a complete mapping, render the plain unbanded tree
  const allMapped = caches.groups.every((g) => g.models.every((m) => caches.modelStore.has(m)));
  if (loadedStores.length === 0 || !allMapped) {
    await walkGroups(buildTop(null), 0, false);
    return out;
  }
  for (const store of loadedStores) {
    onlyStore = store;
    out.push({
      model: -1,
      entry: -1,
      depth: 0,
      name: store,
      hasChildren: false,
      store,
      selected: false,
      hidden: hiddenOf(await groupAgg('')),
    });
    await walkGroups(buildTop(store), 0, false);
  }
  onlyStore = null;
  return out;
}
