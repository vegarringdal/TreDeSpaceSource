// Host event (EVENTS.md `tree.select`): fired when the user clicks a node in
// the tree view OR picks an item in the viewport. Payload gives the fullname
// plus every parent up to the root — import folders first (type 'folder',
// with their cumulative path), then hierarchy ancestors (type 'node').
// Best-effort and async (names come from the worker) — a failure must never
// break the click that triggered it.
import { db } from '../state/viewer/db';
import { emitApiEvent } from './messageApi';

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
