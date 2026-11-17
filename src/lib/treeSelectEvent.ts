// Host event (EVENTS.md `tree.select`): fired when the user clicks a node in
// the tree view OR picks an item in the viewport. Payload gives the fullname
// plus every parent up to the root — import folders first (type 'folder',
// with their cumulative path), then hierarchy ancestors (type 'node').
// Best-effort and async (names come from the worker) — a failure must never
// break the click that triggered it.
//
// The same click also fans out IN-APP through onTreeSelect: panels that follow
// the user's clicks (SQL Detail) get what the host gets, at the same moment —
// before the selection store settles — and on EVERY click, a repeat of the
// node already selected included.
import { db } from '../state/viewer/db';
import { emitApiEvent } from './messageApi';

/** A click as the SQL panels consume it: the tree-view path that seeds
 *  TREE_VIEW_ARGS (import folders, then hierarchy root → the node itself) and
 *  a key matching selection.state's active item (`model:entry`) or group
 *  path, so a store-driven follower can tell this click from an API
 *  selection. */
export interface TreeSelectDetail {
  readonly key: string;
  readonly fullname: string;
  readonly tree: string[];
}

type TreeSelectFn = (detail: TreeSelectDetail) => void;
const listeners = new Set<TreeSelectFn>();

/** Subscribe to in-app tree selects — every path that emits the host event.
 *  Returns an unsubscribe. */
export function onTreeSelect(fn: TreeSelectFn): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function notify(detail: TreeSelectDetail) {
  for (const fn of listeners) {
    fn(detail);
  }
}

function folderParents(path: string) {
  const segs = path.split('/').filter(Boolean);
  return segs.map((name, i) => ({ name, path: segs.slice(0, i + 1).join('/'), type: 'folder' as const }));
}

/** model === -1 means a folder row — pass its path as `group`. */
export function emitTreeSelect(model: number, entry: number, group?: string) {
  void (async () => {
    try {
      if (model === -1) {
        const parents = folderParents(group ?? '');
        const self = parents.pop();
        const folders = (group ?? '').split('/').filter(Boolean);
        if (folders.length) {
          notify({ key: group ?? '', fullname: group ?? '', tree: folders });
        }
        emitApiEvent('tree.select', {
          fullname: group ?? '',
          name: self?.name ?? '',
          folder: true,
          parents,
        });
        return;
      }
      const chain = await db.entryChain(model, entry);
      const self = chain.nodes[chain.nodes.length - 1];
      if (self) {
        notify({
          key: `${model}:${entry}`,
          fullname: self.name,
          tree: [...chain.group.split('/').filter(Boolean), ...chain.nodes.map((n) => n.name)],
        });
      }
      emitApiEvent('tree.select', {
        fullname: self?.name ?? '',
        name: self?.name ?? '',
        folder: self?.hasChildren === true,
        group: chain.group,
        parents: [
          ...folderParents(chain.group),
          ...chain.nodes.slice(0, -1).map((n) => ({ name: n.name, type: 'node' as const })),
        ],
      });
    } catch {
      // best-effort
    }
  })();
}
