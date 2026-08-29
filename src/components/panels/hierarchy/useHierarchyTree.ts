import { useCallback, useEffect, useRef, useState } from 'react';
import type { TreeNode } from '../../../lib/modeldb/modeldbWorker';
import { storesState, TEMP_STORE } from '../../../state/stores/stores.state';
import { db } from '../../../state/viewer/db';
import { selectionState } from '../../../state/viewer/selection.state';
import { registerHierarchyCollapse } from './hierarchy.actions';
import { buildRows, groupKey, type HierarchyCaches, keyOf, type Row } from './hierarchyModel';

export type HierarchyTree = Readonly<{
  rows: Row[];
  expanded: Set<string>;
  expandedRef: React.RefObject<Set<string>>;
  setExp: (next: Set<string>) => void;
  rebuild: (exp: Set<string>) => Promise<void>;
  collapseAll: () => void;
  toggle: (r: Row) => void;
  listRef: React.RefObject<HTMLUListElement | null>;
  modelGroupOf: (model: number) => string | undefined;
}>;

/**
 * Owns the lazy tree: the expansion set (with a synchronous mirror so
 * concurrent rebuilds — a pick fires the reveal and the actives effect in the
 * same tick — all use the SAME set), the worker caches, and the effects that
 * reload models, reveal picks, refresh highlights and scroll to the anchor.
 */
export function useHierarchyTree(): HierarchyTree {
  const sel = selectionState.use();
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandedRef = useRef(expanded);
  const caches = useRef<HierarchyCaches>({
    children: new Map<string, TreeNode[]>(),
    groups: [],
    groupRoots: new Map(),
    modelGroup: new Map(),
    modelStore: new Map(),
    storeOrder: [],
  });
  const { stores } = storesState.use();
  const listRef = useRef<HTMLUListElement | null>(null);
  const pendingScroll = useRef(false);

  const setExp = useCallback((next: Set<string>) => {
    expandedRef.current = next;
    setExpanded(next);
  }, []);

  const rebuild = useCallback(async (exp: Set<string>) => {
    setRows(await buildRows(caches.current, exp));
  }, []);

  // collapse every node; registered globally so the hotkey can reach it
  const collapseAll = useCallback(() => {
    setExp(new Set());
    void rebuild(new Set());
  }, [rebuild, setExp]);

  const toggle = (r: Row) => {
    const k = r.model === -1 ? groupKey(r.group!, r.inStore) : keyOf(r.model, r.entry);
    const exp = new Set(expanded);
    // a folder is open when EITHER its store-qualified or its plain key is in
    // the set (a reveal adds both) — so collapsing must drop both, or the
    // reveal's plain key keeps it open
    const open = exp.has(k) || (r.model === -1 && exp.has(groupKey(r.group!)));
    if (open) {
      exp.delete(k);
      if (r.model === -1) {
        exp.delete(groupKey(r.group!));
      }
    } else {
      exp.add(k);
    }
    setExp(exp);
    void rebuild(exp);
  };

  // the row to scroll to = the leaf of the reveal path (available as soon as
  // the reveal rebuild renders it into the DOM).
  const revealKey = sel.reveal ? keyOf(sel.reveal.model, sel.reveal.path[sel.reveal.path.length - 1]) : null;

  // model list (re)load — modelsVersion is a deliberate refresh TRIGGER (a
  // freshly loaded model must appear without any user interaction)
  // biome-ignore lint/correctness/useExhaustiveDependencies: modelsVersion is an intentional extra trigger
  useEffect(() => {
    let alive = true;
    void (async () => {
      const c = caches.current;
      c.groups = await db.groups();
      c.modelGroup.clear();
      for (const g of c.groups) {
        for (const m of g.models) {
          c.modelGroup.set(m, g.group);
        }
      }
      c.children.clear();
      c.groupRoots.clear();
      // model → store (plant) mapping for the store bands
      c.storeOrder = [...stores.map((s) => s.name), TEMP_STORE];
      c.modelStore.clear();
      for (const { index, store } of await db.modelStores()) {
        c.modelStore.set(index, store);
      }
      if (alive) {
        await rebuild(expanded);
      }
    })();
    return () => {
      alive = false;
    };
  }, [expanded, rebuild, sel.modelsVersion, stores]);

  // viewport pick -> expand the path to the item and mark it for scroll.
  // MUST run before the actives effect so its rebuild sees the expanded path
  // (both fire in the same tick when a pick sets reveal + actives together).
  useEffect(() => {
    if (!sel.reveal) {
      return;
    }
    const { model, path } = sel.reveal;
    const exp = new Set(expandedRef.current);
    const g = caches.current.modelGroup.get(model);
    if (g) {
      // expand every folder LEVEL down to the model ("A/B" needs "A" open
      // too) — qualified for the model's plant band, plus the unqualified
      // key so the unbanded fallback tree expands as well
      const st = caches.current.modelStore.get(model);
      let p = '';
      for (const seg of g.split('/')) {
        p = p ? `${p}/${seg}` : seg;
        exp.add(groupKey(p));
        if (st) {
          exp.add(groupKey(p, st));
        }
      }
    }
    for (const e of path.slice(0, -1)) {
      exp.add(keyOf(model, e));
    }
    setExp(exp);
    pendingScroll.current = true;
    void rebuild(exp);
  }, [sel.reveal, setExp, rebuild]);

  // selection changed elsewhere -> refresh row highlighting. Rebuild from the
  // synchronous expanded mirror so a concurrent reveal isn't undone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: actives/activeGroup are intentional triggers
  useEffect(() => {
    void rebuild(expandedRef.current);
  }, [sel.actives, sel.activeGroup, sel.activeGroups, rebuild]);

  // item states uploaded (hide/show, color rules, snapshots…) -> the nodes'
  // visibility counts are stale: drop the cached nodes so the rebuild refetches
  // them (the worker recomputes its aggregate lazily, once per change)
  useEffect(() => {
    if (sel.stateVersion === 0) {
      return;
    }
    caches.current.children.clear();
    caches.current.groupRoots.clear();
    void rebuild(expandedRef.current);
  }, [sel.stateVersion, rebuild]);

  useEffect(() => {
    registerHierarchyCollapse(collapseAll);
    return () => registerHierarchyCollapse(null);
  }, [collapseAll]);

  // scroll AFTER React committed the rebuilt rows. The anchor row appears one
  // rebuild later than `reveal` (the active highlight arrives async), so keep
  // the flag armed until the ref actually resolves — then center the row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows` is the intentional trigger — retry the scroll after each rebuild until the anchor row exists
  useEffect(() => {
    if (!pendingScroll.current || !revealKey) {
      return;
    }
    // find the row by its stable model:entry key — works whenever it's in the
    // DOM, no matter which rebuild/render settled last.
    const el = listRef.current?.querySelector(`[data-key="${CSS.escape(revealKey)}"]`);
    if (!el) {
      return; // not rendered yet — wait for the next rows/reveal change
    }
    pendingScroll.current = false;
    el.scrollIntoView({ block: 'center' });
  }, [revealKey, rows]);

  return {
    rows,
    expanded,
    expandedRef,
    setExp,
    rebuild,
    collapseAll,
    toggle,
    listRef,
    modelGroupOf: (model) => caches.current.modelGroup.get(model),
  };
}
