import { dialogs } from '../../components/dialogs/dialogs.actions';
import { consoleActions } from '../../components/panels/console/console.actions';
import { quickColorsState } from '../../components/panels/quick-colors/quickColors.state';
import type { PackedNames } from '../../lib/color/packedNames';
import type { ColorRuleSpec, StateUpdate } from '../../lib/modeldb/modeldbWorker';
import type { Renderer } from '../../lib/render/renderer';
import { startTrace, traceEnabled } from '../../lib/trace';
import { emitTreeSelect } from '../../lib/treeSelectEvent';
import { db, transfer } from './db';
import { emitViewportPick, getLastPick } from './pickListeners';
import { residency } from './residency';
import { groupSelKey, selectionState } from './selection.state';
import { initialViewerState, type ViewerState, viewerState } from './viewer.state';

/** The one live renderer instance; the viewport panel registers it on init. */
let renderer: Renderer | null = null;

export function registerRenderer(r: Renderer | null) {
  renderer = r;
  // dev/test hook (harmless in prod; the console is a debugging surface anyway)
  (window as unknown as { __renderer: Renderer | null }).__renderer = r;
}

export function getRenderer(): Renderer | null {
  return renderer;
}

// U/P tree navigation: a fresh pick anchors the deepest path; U walks up to the
// parent, P walks back down toward the originally-picked item.
let navAnchor: { model: number; path: number[] } | null = null;
let navDepth = 0;
function setNavAnchor(model: number, path: number[]) {
  navAnchor = path.length ? { model, path } : null;
  navDepth = path.length;
}
/** Select the entry at the current nav depth WITHOUT resetting the anchor. */
async function navSelect() {
  if (!navAnchor) {
    return;
  }
  const { model, path } = navAnchor;
  const subPath = path.slice(0, navDepth);
  const entry = subPath[subPath.length - 1];
  applyStateUpdates(await db.selectSubtree(model, entry));
  viewerState.set({ suppressTintOnOverride: false });
  selectionState.set({
    activeGroup: null,
    activeGroups: [],
    actives: [`${model}:${entry}`],
    reveal: { model, path: subPath },
  });
  await refreshSelectionMeta({ model, entry });
  emitTreeSelect(model, entry); // host event: U/P changed what is selected
}

/** Load cooked model bytes into the viewer. Returns the renderer slot index
 * plus the pack's missing-item count (nonzero when the bytes are a coarse
 * variant whose cooker cut the tiny items — residency needs it to judge
 * "seen"), or null when skipped (duplicate) or failed. A tombstoned slot for
 * the same folder+name is revived IN PLACE — same slot, same item-id range —
 * so selections, hide state, and colors survive an unload → load cycle. */
export async function loadModelBytes(
  name: string,
  bytes: ArrayBuffer,
  group?: string,
  opts: { edges?: boolean; store?: string } = {},
): Promise<{ slot: number; packDropped: number } | null> {
  if (!renderer) {
    return null;
  }
  const store = opts.store ?? '';
  // already loaded (same store + folder + file name) → skip instead of
  // duplicating geometry. The same folder+name structure loaded from two
  // different STORES is two distinct models.
  if (await db.hasModel(name, group, store)) {
    consoleActions.log('info', `${group ? `${group}/` : ''}${name} is already loaded — skipped`);
    return null;
  }
  try {
    const removedIdx = await db.removedIndexForPath(name, group ?? name, store);
    if (removedIdx >= 0) {
      // bytes are cloned (not transferred) here so an itemcount-mismatch can
      // still fall through to the fresh-slot path below with the bytes intact
      const revived = await reviveSlot(removedIdx, bytes, opts);
      if (revived !== null) {
        refreshHasTransparency();
        return revived;
      }
    }
    // parse + pack in the worker (zero-copy both ways), upload here
    const packed = await db.addModel(name, transfer(bytes, [bytes]), group, store);
    const slot = renderer.uploadModel(packed, opts);
    refreshHasTransparency(); // baked material alpha may need the blend pass
    return { slot, packDropped: packed.packDropped };
  } catch (e) {
    consoleActions.log('error', `failed to parse ${name}: ${e}`);
    return null;
  }
}

/** Revive a tombstoned worker+renderer slot with fresh bytes. Returns the slot
 * on success, null on itemcount-mismatch (caller loads into a fresh slot). If
 * the GPU upload fails after the worker side revived, the worker slot is
 * re-tombstoned so the two model arrays stay consistent. */
async function reviveSlot(
  slot: number,
  bytes: ArrayBuffer,
  opts: { edges?: boolean },
): Promise<{ slot: number; packDropped: number } | null> {
  if (!renderer) {
    return null;
  }
  let packed: Awaited<ReturnType<typeof db.reviveModel>>;
  try {
    packed = await db.reviveModel(slot, bytes);
  } catch (e) {
    if (String(e).includes('itemcount-mismatch')) {
      return null; // re-cooked file changed shape — a fresh slot is correct
    }
    throw e;
  }
  try {
    renderer.reviveModel(slot, packed, opts);
  } catch (e) {
    await db.removeModels([slot]);
    throw e;
  }
  applyStateUpdates(await db.statesFor([slot]));
  return { slot, packDropped: packed.packDropped };
}

// keep the blend-pass gate current (async; a frame of lag is fine)
function refreshHasTransparency() {
  void db.hasTransparency().then((t) => {
    if (viewerState.get().hasTransparency !== t) {
      viewerState.set({ hasTransparency: t });
    }
  });
}

/** Push worker-produced per-model item states to the GPU (also used by the
 *  residency manager after a variant swap recreates a model's state buffer). */
export function applyStateUpdates(updates: StateUpdate[]) {
  if (!renderer) {
    return;
  }
  for (const u of updates) {
    renderer.writeItemStates(u.model, u.states);
  }
  refreshHasTransparency();
  if (updates.length) {
    selectionState.set((p) => ({ stateVersion: p.stateVersion + 1 }));
  }
}

/** Upload a worker-produced bulk state result (snapshot import): per-model
 *  item states, optionally the transform pool, then refresh the selection
 *  banner — the import resets the undo depths. */
export async function applyWorkerStateResult(updates: StateUpdate[], transforms?: Float32Array | null): Promise<void> {
  if (transforms) {
    renderer?.writeTransforms(transforms);
  }
  applyStateUpdates(updates);
  await refreshSelectionMeta();
}

async function refreshSelectionMeta(active: SelectionStateActive = null) {
  selectionState.set({
    count: await db.selectionCount(),
    colorUndoDepth: await db.colorUndoDepth(),
    colorRedoDepth: await db.colorRedoDepth(),
    transformUndoDepth: await db.transformUndoDepth(),
    transformRedoDepth: await db.transformRedoDepth(),
    bounds: await db.selectionBounds(),
    ...(active !== undefined ? { active } : {}),
  });
}
type SelectionStateActive = { model: number; entry: number } | null | undefined;

/** Active keys whose entry lies UNDER any of `removed` (same model) — their
 *  items just went with the removed subtree, so they must stop being roots or
 *  the tree keeps painting them selected (a Shift range makes every visible
 *  row its own root, descendants included). */
async function keysUnder(actives: string[], model: number, removed: number[]): Promise<Set<string>> {
  const gone = new Set<string>();
  const removedSet = new Set(removed);
  await Promise.all(
    actives.map(async (k) => {
      const [m, e] = k.split(':').map(Number);
      if (m !== model || removedSet.has(e)) {
        return;
      }
      const path = await db.pathForEntry(model, e);
      if (path.some((anc) => anc !== e && removedSet.has(anc))) {
        gone.add(k);
      }
    }),
  );
  return gone;
}

/** For a node being deselected: the highest ACTIVE ancestor on its path (if
 *  any) and the keys of the sibling subtrees along that path that stay fully
 *  selected — what replaces the ancestor as selection roots. */
async function splitActiveAncestor(
  model: number,
  entry: number,
): Promise<{ ancestorKeys: string[]; siblingKeys: string[] } | null> {
  const actives = new Set(selectionState.get().actives);
  const path = await db.pathForEntry(model, entry); // root … entry
  const top = path.findIndex((e, i) => i < path.length - 1 && actives.has(`${model}:${e}`));
  if (top < 0) {
    return null;
  }
  // EVERY active ancestor on the path is no longer fully selected — a Shift
  // range can make the root, the child and the grandchild roots at once, and
  // demoting only the highest would leave the next one painting the branch
  const ancestorKeys = path
    .slice(0, -1)
    .filter((e) => actives.has(`${model}:${e}`))
    .map((e) => `${model}:${e}`);
  const siblingKeys: string[] = [];
  for (let i = top; i < path.length - 1; i++) {
    for (const kid of await db.children(model, path[i])) {
      if (kid.entry !== path[i + 1]) {
        siblingKeys.push(`${model}:${kid.entry}`);
      }
    }
  }
  return { ancestorKeys, siblingKeys };
}

// -----------------------------------------------------------------------------
// camera helpers
// -----------------------------------------------------------------------------

/** Glide the camera to frame a world box: pivot on its centre at the distance
 *  that puts the bounding sphere (13% margin) inside the vertical FOV — the
 *  same framing camera.fit() uses for the load view. */
function flyToBounds(bounds: { min: readonly number[]; max: readonly number[] }, smoothTime = 0.6) {
  if (!renderer) {
    return;
  }
  const { min, max } = bounds;
  const center: [number, number, number] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]), 0.5);
  renderer.camera.dolly(center, (radius * 1.3) / Math.tan(renderer.camera.fovY / 2), smoothTime);
}

/** Await the end of an in-flight camera move when the caller asked to wait —
 *  host commands that must not respond mid-glide. */
async function settleCamera(wait?: boolean): Promise<void> {
  if (wait && renderer) {
    await renderer.camera.settled();
  }
}

export const viewerActions = {
  update(patch: Partial<ViewerState>) {
    viewerState.set(patch);
  },

  reset() {
    viewerState.set(initialViewerState);
    consoleActions.log('warn', 'Viewer settings reset to defaults');
  },

  setProjection(orthographic: boolean) {
    viewerState.set({ orthographic });
    consoleActions.log('info', `Camera → ${orthographic ? 'orthographic' : 'perspective'}`);
  },

  /** Hierarchy → Remove: unload specific model files. Worker + renderer keep
   *  the slots (tombstoned) so remaining model indices stay aligned. */
  async removeModels(indices: number[], label?: string) {
    if (!renderer || indices.length === 0) {
      return;
    }
    const what = label ?? `${indices.length} model file(s)`;
    if (!(await dialogs.confirm(`Remove ${what} from the viewer?`, { okLabel: 'Remove' }))) {
      return;
    }
    await viewerActions.removeModelsQuiet(indices, what);
  },

  /** removeModels without the confirm dialog — the postMessage API's unload
   *  (a host already decided; a modal would hang the request). */
  async removeModelsQuiet(indices: number[], label?: string) {
    if (!renderer || indices.length === 0) {
      return;
    }
    residency.unregister(indices);
    renderer.removeModels(indices);
    await db.removeModels(indices);
    applyStateUpdates(await db.clearSelection());
    selectionState.set({ count: 0, active: null, actives: [], activeGroup: null, activeGroups: [], reveal: null });
    selectionState.set((p) => ({ modelsVersion: p.modelsVersion + 1 }));
    consoleActions.log('warn', `Removed ${label ?? `${indices.length} model file(s)`}`);
  },

  /** Remove a hierarchy folder: every model in the group and its subgroups. */
  async removeGroups(groups: string[], label?: string, store?: string) {
    const all = await db.groups();
    const inStore = store != null ? new Set(await db.indicesForStore(store)) : null;
    const models = new Set<number>();
    for (const g of all) {
      if (groups.some((p) => g.group === p || g.group.startsWith(`${p}/`))) {
        for (const m of g.models) {
          if (inStore === null || inStore.has(m)) {
            models.add(m);
          }
        }
      }
    }
    await viewerActions.removeModels([...models], label ?? `folder(s) ${groups.join(', ')}`);
  },

  /** Home → Remove: unload everything. */
  async removeAll() {
    if (!renderer || renderer.stats.models === 0) {
      return;
    }
    if (!(await dialogs.confirm('Unload all models?', { okLabel: 'Remove' }))) {
      return;
    }
    residency.reset();
    renderer.clearModels();
    await db.clear();
    selectionState.set({
      count: 0,
      active: null,
      actives: [],
      activeGroup: null,
      activeGroups: [],
      reveal: null,
      colorUndoDepth: 0,
      colorRedoDepth: 0,
      transformUndoDepth: 0,
      transformRedoDepth: 0,
    });
    selectionState.set((p) => ({ modelsVersion: p.modelsVersion + 1 }));
    consoleActions.log('warn', 'All models removed');
  },

  /** Tree click: select every item under (model, entry). */
  async selectSubtree(model: number, entry: number) {
    applyStateUpdates(await db.selectSubtree(model, entry));
    viewerState.set({ suppressTintOnOverride: false });
    selectionState.set({ activeGroup: null, activeGroups: [], actives: [`${model}:${entry}`] });
    // anchor U/P at the clicked node's full ancestor path so U walks up and P
    // returns to the manually-selected node
    setNavAnchor(model, await db.pathForEntry(model, entry));
    await refreshSelectionMeta({ model, entry });
  },

  /** Digit+click: select the picked item's ancestor `level` steps below the
   *  model root (clamped to the path depth) and reveal it in the tree —
   *  the tree expands only down to that node, not further. */
  async selectAtLevel(model: number, item: number, level: number) {
    const path = await db.pathForItem(model, item);
    if (path.length === 0) {
      return;
    }
    const idx = Math.min(level, path.length) - 1;
    await viewerActions.selectSubtree(model, path[idx]);
    selectionState.set({ reveal: { model, path: path.slice(0, idx + 1) } });
    emitTreeSelect(model, path[idx]); // host event (EVENTS.md)
  },

  /** U hotkey: select the parent of the current selection (walk up the tree). */
  async navUp() {
    if (!navAnchor || navDepth <= 1) {
      return;
    }
    navDepth--;
    await navSelect();
  },
  /** P hotkey: walk back down toward the originally-picked item. */
  async navDown() {
    if (!navAnchor || navDepth >= navAnchor.path.length) {
      return;
    }
    navDepth++;
    await navSelect();
  },

  /** The tree-view path (import folders first, then the entry chain, top →
   *  leaf) of what was selected LAST — the current selection root from a
   *  tree click, a viewport pick, U / P or an API select; a selected folder
   *  gives the folder path; a viewport pick with no root falls back to the
   *  picked item. [] when nothing is selected. What TREE_VIEW_ARGS and the
   *  Set Color "+" button are fed from. */
  async lastSelectedTree(): Promise<string[]> {
    const { active, activeGroup } = selectionState.get();
    if (active) {
      const chain = await db.entryChain(active.model, active.entry);
      if (chain.nodes.length) {
        return [...chain.group.split('/').filter(Boolean), ...chain.nodes.map((n) => n.name)];
      }
    }
    if (activeGroup) {
      return (activeGroup.split('\0').pop() ?? '').split('/').filter(Boolean);
    }
    const pick = getLastPick();
    return pick ? await db.itemFullnamePath(pick.model, pick.item) : [];
  },

  /** The name of what was selected LAST (the leaf of lastSelectedTree), or
   *  null when nothing is selected. */
  async lastSelectedName(): Promise<string | null> {
    const path = await viewerActions.lastSelectedTree();
    return path[path.length - 1] ?? null;
  },

  /** Select one item by its model fullname (with/without leading '/') —
   *  replaces the selection and reveals it in the tree. */
  async select(fullname: string) {
    await viewerActions.selectByFullnames([fullname]);
  },

  /** Select many items by fullname (replaces the selection, reveals the
   *  first). `append` keeps what is already selected and adds to it — the
   *  host API's additive selection. Returns what matched and which names
   *  resolved to nothing — hosts driving the app over postMessage need the
   *  misses. */
  async selectByFullnames(
    names: string[],
    opts: { append?: boolean } = {},
  ): Promise<{ matched: number; missed: string[] }> {
    const hits = await db.findEntriesByNames(names);
    const foundLower = new Set(hits.map((h) => h.name.toLowerCase().replace(/^\//, '')));
    const missed = names.filter((n) => !foundLower.has(n.trim().toLowerCase().replace(/^\//, '')));
    if (hits.length === 0) {
      return { matched: 0, missed };
    }
    if (!opts.append) {
      applyStateUpdates(await db.clearSelection());
    }
    applyStateUpdates(await db.addSubtrees(hits.map((h) => ({ model: h.model, entry: h.entry }))));
    viewerState.set({ suppressTintOnOverride: false });
    const first = hits[0];
    const keys = hits.map((h) => `${h.model}:${h.entry}`);
    const reveal = { model: first.model, path: await db.pathForEntry(first.model, first.entry) };
    selectionState.set((prev) =>
      opts.append
        ? { activeGroup: null, actives: [...new Set([...prev.actives, ...keys])], reveal }
        : { activeGroup: null, activeGroups: [], actives: keys, reveal },
    );
    await refreshSelectionMeta({ model: first.model, entry: first.entry });
    return { matched: hits.length, missed };
  },

  /** selectByFullnames for a packed list (a big SQL result): the names never
   *  exist as strings on the main thread — the worker resolves and selects
   *  them and hands back flat (model, entry) pairs for the tree highlight.
   *  `append` adds to the current selection instead of replacing it. */
  async selectByPacked(p: PackedNames, opts: { append?: boolean } = {}): Promise<{ matched: number; missed: number }> {
    const r = await db.selectPacked(p, opts.append === true);
    applyStateUpdates(r.updates);
    if (r.matched === 0) {
      return { matched: 0, missed: r.missed };
    }
    viewerState.set({ suppressTintOnOverride: false });
    const actives: string[] = new Array(r.matched);
    for (let i = 0; i < r.matched; i++) {
      actives[i] = `${r.pairs[i * 2]}:${r.pairs[i * 2 + 1]}`;
    }
    const first = { model: r.pairs[0], entry: r.pairs[1] };
    const reveal = { model: first.model, path: await db.pathForEntry(first.model, first.entry) };
    selectionState.set((prev) =>
      opts.append
        ? { activeGroup: null, actives: [...new Set([...prev.actives, ...actives])], reveal }
        : { activeGroup: null, activeGroups: [], actives, reveal },
    );
    await refreshSelectionMeta(first);
    return { matched: r.matched, missed: r.missed };
  },

  /** Ctrl+click: toggle a subtree in/out of the selection. */
  async toggleSubtree(model: number, entry: number) {
    const { updates, added } = await db.modifySubtreeSelection(model, entry, 'toggle');
    applyStateUpdates(updates);
    viewerState.set({ suppressTintOnOverride: false });
    const key = `${model}:${entry}`;
    // Toggling OFF a node that sits under an ACTIVE root (a Shift range over an
    // expanded parent and its children puts the parent in `actives`): the tree
    // paints every row under an active root as selected, so dropping only the
    // child's key would leave it highlighted while its items are gone. Split
    // that root: it stops being a root and its remaining fully-selected
    // siblings along the path become roots instead — the tree then matches
    // the worker's selection exactly.
    const split = added ? null : await splitActiveAncestor(model, entry);
    // descendants that were roots of their own (range rows) lose their items
    // with this subtree — drop their keys too, or they stay painted selected
    const under = added ? new Set<string>() : await keysUnder(selectionState.get().actives, model, [entry]);
    selectionState.set((p) => {
      let actives = p.actives.filter((k) => k !== key && !under.has(k));
      if (split) {
        const demoted = new Set(split.ancestorKeys);
        actives = [...actives.filter((k) => !demoted.has(k)), ...split.siblingKeys];
      }
      return { activeGroup: null, actives: added ? [...actives, key] : actives };
    });
    await refreshSelectionMeta(added ? { model, entry } : undefined);
  },

  /** Shift+click: add a range of subtrees to the selection. */
  async addSubtrees(pairs: { model: number; entry: number }[]) {
    if (pairs.length === 0) {
      return;
    }
    applyStateUpdates(await db.addSubtrees(pairs));
    viewerState.set({ suppressTintOnOverride: false });
    const keys = pairs.map((p) => `${p.model}:${p.entry}`);
    selectionState.set((p) => ({
      activeGroup: null,
      actives: [...new Set([...p.actives, ...keys])],
    }));
    const last = pairs[pairs.length - 1];
    await refreshSelectionMeta({ model: last.model, entry: last.entry });
  },

  /** Ctrl+click a folder row: toggle the whole group in/out of the selection.
   *  `store` scopes to one plant's copy of the folder (band-scoped rows). */
  async toggleGroup(group: string, store?: string) {
    const { updates, added, roots } = await db.modifyGroupSelection(group, store);
    applyStateUpdates(updates);
    viewerState.set({ suppressTintOnOverride: false });
    const gk = groupSelKey(group, store);
    const keys = new Set(roots.map((r) => `${r.model}:${r.entry}`));
    // same descendant pruning as toggleSubtree, per model of the removed roots
    const under = new Set<string>();
    if (!added) {
      const byModel = new Map<number, number[]>();
      for (const r of roots) {
        byModel.set(r.model, [...(byModel.get(r.model) ?? []), r.entry]);
      }
      const actives = selectionState.get().actives;
      for (const [m, entries] of byModel) {
        for (const k of await keysUnder(actives, m, entries)) {
          under.add(k);
        }
      }
    }
    selectionState.set((p) => ({
      activeGroup: null,
      activeGroups: added ? [...new Set([...p.activeGroups, gk])] : p.activeGroups.filter((g) => g !== gk),
      actives: added ? [...new Set([...p.actives, ...keys])] : p.actives.filter((k) => !keys.has(k) && !under.has(k)),
    }));
    await refreshSelectionMeta(null);
  },

  /** Folder row click: select everything in the import group. `store` scopes
   *  to one plant's copy of the folder (band-scoped rows). */
  async selectGroup(group: string, store?: string) {
    applyStateUpdates(await db.selectGroup(group, store));
    viewerState.set({ suppressTintOnOverride: false });
    selectionState.set({ activeGroup: groupSelKey(group, store), activeGroups: [], actives: [] });
    await refreshSelectionMeta(null);
  },

  async clearSelection() {
    applyStateUpdates(await db.clearSelection());
    selectionState.set({ activeGroup: null, activeGroups: [], actives: [] });
    await refreshSelectionMeta(null);
  },

  /** Viewport click: id-buffer value -> select that single item + reveal it.
   * additive (ctrl+click) toggles the item in/out instead of replacing —
   * routed through the same subtree op the tree's ctrl+click uses. */
  async selectFromPick(globalId: number | null, additive = false) {
    if (globalId === null) {
      if (!additive) {
        await viewerActions.clearSelection();
      }
      return;
    }
    const hit = renderer?.itemFromGlobalId(globalId);
    if (!hit) {
      return;
    }
    emitViewportPick(hit.model, hit.item); // feed click-following panels (SQL Detail)
    const path = await db.pathForItem(hit.model, hit.item);
    if (path.length) {
      emitTreeSelect(hit.model, path[path.length - 1]); // host event (EVENTS.md)
    }
    if (additive && path.length) {
      await viewerActions.toggleSubtree(hit.model, path[path.length - 1]);
      selectionState.set({ reveal: { model: hit.model, path } });
      return;
    }
    applyStateUpdates(await db.selectItems(hit.model, Uint32Array.from([hit.item])));
    viewerState.set({ suppressTintOnOverride: false });
    const active = path.length ? { model: hit.model, entry: path[path.length - 1] } : null;
    selectionState.set({
      reveal: path.length ? { model: hit.model, path } : null,
      activeGroup: null,
      actives: path.length ? [`${hit.model}:${path[path.length - 1]}`] : [],
    });
    setNavAnchor(hit.model, path); // anchor U/P navigation to this pick
    await refreshSelectionMeta(active);
  },

  /** Fit the camera to the selection's bounding box (animated). */
  async flyToSelection() {
    if (!renderer) {
      return;
    }
    const bounds = await db.selectionBounds();
    if (!bounds) {
      return;
    }
    flyToBounds(bounds);
  },

  /** Focus = Alt+click replay: re-pivot on the last clicked point, camera stays. */
  focusLastClick() {
    const p = renderer?.lastClickWorld;
    if (renderer && p) {
      renderer.camera.rePivot([p[0], p[1], p[2]]);
    }
  },

  /** Focus the selection: re-pivot on its bounds center, camera stays put. */
  async focusSelection() {
    if (!renderer) {
      return;
    }
    const bounds = await db.selectionBounds();
    if (!bounds) {
      // Failing silently here hid a real bug for a whole session. The count
      // separates the two causes: 0 means the worker's selection is genuinely
      // empty (the tree is showing something the model DB does not have),
      // anything else means every selected item has non-finite bounds — i.e.
      // it contributed no meshlets at pack time.
      const n = await db.selectionCount();
      consoleActions.log(
        'info',
        n === 0
          ? 'Focus selection — the model DB has no selection'
          : `Focus selection — ${n} item(s) selected but none has geometry bounds`,
      );
      return;
    }
    const { min, max } = bounds;
    renderer.camera.rePivot([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]);
  },

  /** Host API `nav.flyTo`: fly the camera to a fullname's subtree; `select`
   *  also selects it, otherwise the selection is left untouched. `wait`
   *  resolves only once the move has landed (the glide is an animation the
   *  render loop drives). Returns whether the name matched anything. */
  async flyToFullname(fullname: string, opts: { select?: boolean; wait?: boolean } = {}): Promise<boolean> {
    if (!renderer) {
      return false;
    }
    if ((await db.findEntriesByNames([fullname])).length === 0) {
      return false;
    }
    if (opts.select) {
      await viewerActions.selectByFullnames([fullname]);
      await viewerActions.flyToSelection();
      await settleCamera(opts.wait);
      return true;
    }
    const bounds = await db.boundsForNames([fullname]);
    if (!bounds) {
      return true; // matched, but no geometry to frame
    }
    flyToBounds(bounds);
    await settleCamera(opts.wait);
    return true;
  },

  /** Host API `nav.orbit`: set the orbit pivot to a fullname's centre (camera
   *  stays put); `select` also selects it, `wait` resolves once the re-pivot
   *  has landed. Returns whether the name matched. */
  async orbitFullname(fullname: string, opts: { select?: boolean; wait?: boolean } = {}): Promise<boolean> {
    if (!renderer) {
      return false;
    }
    if ((await db.findEntriesByNames([fullname])).length === 0) {
      return false;
    }
    if (opts.select) {
      await viewerActions.selectByFullnames([fullname]);
    }
    const bounds = await db.boundsForNames([fullname]);
    if (!bounds) {
      return true;
    }
    const { min, max } = bounds;
    renderer.camera.rePivot([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]);
    await settleCamera(opts.wait);
    return true;
  },

  /** Frame everything that is NOT hidden (the host API `nav.fitVisible` and
   *  the Fit-visible button): the union box of every visible item, moved
   *  geometry included. False when nothing visible is left to frame. */
  async fitVisible(opts: { wait?: boolean } = {}): Promise<boolean> {
    if (!renderer) {
      return false;
    }
    const bounds = await db.visibleWorldBounds();
    if (!bounds) {
      return false;
    }
    flyToBounds(bounds);
    await settleCamera(opts.wait);
    return true;
  },

  async invertSelection() {
    applyStateUpdates(await db.invertSelection());
    viewerState.set({ suppressTintOnOverride: false });
    selectionState.set({ activeGroup: null, activeGroups: [], actives: [] });
    await refreshSelectionMeta(null);
  },

  /** Opacity overrides (state undo domain, like coloring). */
  async setOpacity(pct: number) {
    applyStateUpdates(await db.setOpacityOnSelection(pct));
    await refreshSelectionMeta(undefined);
  },

  async resetOpacity() {
    applyStateUpdates(await db.resetOpacityOnSelection());
    await refreshSelectionMeta(undefined);
  },

  async resetAllOpacity() {
    applyStateUpdates(await db.resetAllOpacity());
    await refreshSelectionMeta(undefined);
  },

  /** Hiding (state undo domain — the ribbon Undo reverts it like coloring). */
  async hideSelection() {
    applyStateUpdates(await db.hideSelection());
    await refreshSelectionMeta(undefined);
  },

  /** Item-boundary edge lines on/off for the selected items (undoable like a
   *  hide). Shows only while Settings → Edges → item edges is on. */
  async setItemEdgesOnSelection(on: boolean) {
    applyStateUpdates(await db.setItemEdgesOnSelection(on));
    consoleActions.log('info', `Item edges ${on ? 'enabled' : 'disabled'} on the selection`);
  },

  async isolateSelection() {
    applyStateUpdates(await db.isolateSelection());
    await refreshSelectionMeta(undefined);
  },

  async unhideAll() {
    applyStateUpdates(await db.unhideAll());
    await refreshSelectionMeta(undefined);
  },

  /** Unhide every hidden item intersecting an oriented world-space box. */
  async unhideIntersecting(box: {
    center: [number, number, number];
    size: [number, number, number];
    rotation: [number, number, number, number];
  }) {
    applyStateUpdates(await db.unhideIntersecting(box));
    await refreshSelectionMeta(undefined);
  },

  /** Unhide every hidden item within `margin` of ANY selected leaf item. */
  async unhideAroundSelectedItems(margin: number) {
    applyStateUpdates(await db.unhideAroundSelectedItems(margin));
    await refreshSelectionMeta(undefined);
  },

  /** Coloring (state undo domain, shared with opacity/visibility — no global
   * undo by design; transforms have their own stack).
   * opacityPct becomes the ALPHA of the color override itself — it travels
   * (and undoes) with the color, independent of the opacity-override flag. */
  async applyColor(hex: string, opacityPct = 100) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const a = Math.max(0, Math.min(255, Math.round(opacityPct * 2.55)));
    const packed = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
    applyStateUpdates(await db.applyColorToSelection(packed));
    viewerState.set({ suppressTintOnOverride: true }); // show the color, not the tint
    await refreshSelectionMeta(undefined);
  },

  async resetAllColors() {
    applyStateUpdates(await db.resetAllColors());
    await refreshSelectionMeta(undefined);
  },

  /** MultiColor: run the whole rule sequence in the worker (selection is
   *  untouched). Returns per-rule match counts for the panel. */
  async applyColorRules(rules: ColorRuleSpec[], mode: 'reset' | 'append' | 'hide'): Promise<number[]> {
    const trace = startTrace('applyColorRules');
    const callStart = performance.now();
    const { updates, counts, trace: workerTrace } = await db.applyColorRules(rules, mode, traceEnabled());
    if (trace) {
      // round-trip minus the worker's own reported phases = the pure Comlink
      // serialize/transfer overhead, so all phases add up to the total
      const roundTrip = performance.now() - callStart;
      const workerSum = workerTrace?.reduce((sum, p) => sum + p.ms, 0) ?? 0;
      trace.add('comlink serialize + transfer', Math.max(0, roundTrip - workerSum));
      trace.merge(workerTrace); // worker phases, in order
    }
    applyStateUpdates(updates);
    trace?.mark('gpu upload (apply state updates)');
    viewerState.set({ suppressTintOnOverride: true });
    await refreshSelectionMeta(undefined);
    trace?.mark('refresh selection meta');
    trace?.flush();
    return counts;
  },

  /** Apply quick-color slot `i` (0-based) to the selection — used by the
   *  quick-color swatch hotkeys. Reads the live palette; full opacity. */
  async applyQuickColor(i: number) {
    const c = quickColorsState.get().colors[i];
    if (c) {
      await viewerActions.applyColor(c, 100);
    }
  },

  async unhideSelection() {
    applyStateUpdates(await db.unhideSelection());
  },

  /** Clear every override EVERYWHERE at once: unhide all + reset all colors +
   *  reset all opacity (the Alt&R hotkey / "Clear all" button) — one worker
   *  call, ONE undo step. */
  async clearAllOverrides() {
    await viewerActions.clearOverrides({ color: true, opacity: true, hidden: true });
  },

  /** Clear only the chosen override kinds everywhere (host API `model.reset`),
   *  as one undo step. */
  async clearOverrides(kinds: { color?: boolean; opacity?: boolean; hidden?: boolean }) {
    applyStateUpdates(await db.clearOverrides(kinds));
    await refreshSelectionMeta(undefined);
  },

  async clearColor() {
    applyStateUpdates(await db.clearColorOnSelection());
    await refreshSelectionMeta(undefined);
  },

  async undoColor() {
    applyStateUpdates(await db.undoColor());
    await refreshSelectionMeta(undefined);
  },

  async redoColor() {
    applyStateUpdates(await db.redoColor());
    await refreshSelectionMeta(undefined);
  },

  /** Nudge the selection's committed transform (TRANSFORM undo domain).
   * move: meters, rotate: degrees, scale: percent — all along/around a
   * world axis, rotate/scale about the selection center. */
  async transformSelection(
    kind: 'move' | 'rotate' | 'scale' | 'scale-uniform',
    axis: 0 | 1 | 2,
    dir: 1 | -1,
    amount: number,
    pivot?: [number, number, number] | null,
  ) {
    const { updates, transforms } = await db.transformSelection(kind, axis, dir, amount, pivot);
    if (updates.length === 0) {
      return;
    }
    renderer?.writeTransforms(transforms);
    applyStateUpdates(updates);
    await refreshSelectionMeta(undefined);
  },

  /** Live gizmo-drag preview: one UBO write per model, no bake. */
  liveSelectionTransform(matrix: Float32Array | null) {
    renderer?.setSelectionTransform(matrix);
  },

  /** Drag end: bake the group matrix into committed slots (undoable), then
   * drop the live preview in the same frame. */
  async bakeSelectionTransform(matrix: Float32Array) {
    const { updates, transforms } = await db.applyGroupTransform(matrix);
    if (updates.length > 0) {
      renderer?.writeTransforms(transforms);
      applyStateUpdates(updates);
    }
    renderer?.setSelectionTransform(null);
    await refreshSelectionMeta(undefined);
  },

  async resetTransformSel() {
    applyStateUpdates(await db.resetTransformOnSelection());
    await refreshSelectionMeta(undefined);
  },

  async resetAllTransforms() {
    applyStateUpdates(await db.resetAllTransforms());
    await refreshSelectionMeta(undefined);
  },

  async undoTransform() {
    applyStateUpdates(await db.undoTransform());
    await refreshSelectionMeta(undefined);
  },

  async redoTransform() {
    applyStateUpdates(await db.redoTransform());
    await refreshSelectionMeta(undefined);
  },

  bumpModelsVersion() {
    selectionState.set((p) => ({ modelsVersion: p.modelsVersion + 1 }));
  },
};
