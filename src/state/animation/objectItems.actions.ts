// An object's items (DESIGN.md › Animation › Authoring): like a Navisworks
// animation set it holds nodes, and — better — nodes to leave out, so it can
// be "this group minus a few". Add / remove the selection, drop one entry,
// and take the closest group the worker finds for the same items. Every
// edit goes through commit (undoable).

import { toast } from '@treDeSpaceUI/widgets';
import type { AnimObject } from '../../lib/animation/types';
import type { ClosestGroup } from '../../lib/modeldb/apiAnimation';
import { db } from '../viewer/db';
import { animationDocActions } from './animationDoc.actions';
import { animationDocState } from './animationDoc.state';
import { findObject, mapObject } from './docEdit';

// -----------------------------------------------------------------------------
// types + helpers
// -----------------------------------------------------------------------------

interface ItemSet {
  items: string[];
  exclude: string[];
}

function objectOf(id: string): AnimObject | null {
  return findObject(animationDocState.get().doc, id)?.object ?? null;
}

function setOf(o: AnimObject): ItemSet {
  return { items: o.items, exclude: o.exclude ?? [] };
}

/** Commit a new item set (an empty one is refused — an object needs items). */
function commitSet(id: string, next: ItemSet): boolean {
  if (next.items.length === 0) {
    toast.info('An object needs at least one item — delete the object instead.');
    return false;
  }
  animationDocActions.commit((d) =>
    mapObject(d, id, (o) => {
      const { exclude: _old, ...rest } = o;
      return next.exclude.length > 0
        ? { ...rest, items: next.items, exclude: next.exclude }
        : { ...rest, items: next.items };
    }),
  );
  return true;
}

/** Would `next` resolve to no items where `now` still has some (a group
 *  with every node under it left out)? */
async function leavesNothing(id: string, now: ItemSet, next: ItemSet): Promise<boolean> {
  const [a, b] = await db.animCountItems([
    { actor: id, fullnames: now.items, exclude: now.exclude },
    { actor: id, fullnames: next.items, exclude: next.exclude },
  ]);
  return (a?.items ?? 0) > 0 && (b?.items ?? 0) === 0;
}

/** The selected nodes (topmost fully selected), or null with a hint. */
async function selectedNames(): Promise<string[] | null> {
  const sel = await db.animActorFromSelection();
  if (!sel) {
    toast.info('Select the items first (in the 3D view or the Hierarchy).');
    return null;
  }
  return sel.fullnames;
}

/** Add or take out the selection; the worker knows the hierarchy, so the
 *  lists change the least and stay tidy. */
async function editWithSelection(id: string, op: 'add' | 'remove'): Promise<void> {
  const o = objectOf(id);
  const names = o ? await selectedNames() : null;
  if (!o || !names) {
    return;
  }
  const s = setOf(o);
  const next = await db.animEditItemSet(s.items, s.exclude, names, op);
  if (JSON.stringify(next) === JSON.stringify(s)) {
    toast.info(op === 'add' ? 'The selection is in the object already.' : 'The selection is not in the object.');
    return;
  }
  if (op === 'remove' && (await leavesNothing(id, s, next))) {
    toast.info('That would leave the object with no items — delete the object instead.');
    return;
  }
  commitSet(id, next);
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const objectItemsActions = {
  /** The selected nodes join the object (a node it left out comes back). */
  async addSelection(id: string): Promise<void> {
    await editWithSelection(id, 'add');
  },

  /** The selected nodes leave the object (listed ones are dropped, ones
   *  inside a listed group are left out — "the group minus these"). */
  async removeSelection(id: string): Promise<void> {
    await editWithSelection(id, 'remove');
  },

  /** Drop one entry of the object's lists. */
  removeEntry(id: string, name: string, list: 'items' | 'exclude'): void {
    const o = objectOf(id);
    if (!o) {
      return;
    }
    const s = setOf(o);
    commitSet(
      id,
      list === 'items'
        ? { items: s.items.filter((x) => x !== name), exclude: s.exclude }
        : { items: s.items, exclude: s.exclude.filter((x) => x !== name) },
    );
  },

  /** How many items the object's lists hold in the loaded models. */
  async count(id: string): Promise<number | null> {
    const o = objectOf(id);
    if (!o) {
      return null;
    }
    const [r] = await db.animCountItems([{ actor: o.id, fullnames: o.items, exclude: o.exclude ?? [] }]);
    return r?.items ?? null;
  },

  /** Each of the object's entries (added and left out) as the tree spells
   *  it, keyed by the stored lower-case name. */
  async treeNames(id: string): Promise<Record<string, string>> {
    const o = objectOf(id);
    if (!o) {
      return {};
    }
    const names = [...o.items, ...(o.exclude ?? [])];
    const shown = await db.animTreeNames(names);
    return Object.fromEntries(names.map((n, i) => [n, shown[i] ?? n]));
  },

  /** The closest group naming the object's items more simply, or null. */
  async closestGroup(id: string): Promise<ClosestGroup | null> {
    const o = objectOf(id);
    if (!o || (o.items.length < 2 && !o.exclude?.length)) {
      return null;
    }
    return db.animClosestGroup(o.items, o.exclude ?? []);
  },

  /** Name the object's items as the closest group minus a few. */
  async applyClosestGroup(id: string): Promise<void> {
    const g = await objectItemsActions.closestGroup(id);
    if (!g) {
      toast.info('No simpler group holds exactly these items.');
      return;
    }
    if (commitSet(id, { items: [g.group], exclude: g.minus })) {
      toast.success(
        `Now ${g.name}${g.minus.length ? ` minus ${g.minus.length} node${g.minus.length === 1 ? '' : 's'}` : ''} — the same ${g.items} item(s).`,
      );
    }
  },
};
