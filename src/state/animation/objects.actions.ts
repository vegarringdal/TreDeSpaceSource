// Objects (DESIGN.md › Animation › Authoring): made from the selection —
// named after the selected node — with one row of keys each. Update from
// selection swaps the items and keeps every key; the pivot and the path
// belong to the object. Every edit goes through commit (undoable).

import { toast } from '@treDeSpaceUI/widgets';
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { ribbonSelectionTransformState } from '../../components/panels/ribbon-selection-transform/ribbonSelectionTransform.state';
import {
  decomposeRigid,
  m4Identity,
  m4InvertRigid,
  m4Multiply,
  m4TransformPoint,
  poseMatrix,
} from '../../lib/animation/interp';
import { newId } from '../../lib/animation/io';
import { keyHere, rePivot, SLIDE_DIRECTIONS, slideInKeys } from '../../lib/animation/keyRows';
import type { AnimObject, Interp, MotionPath, ObjectPivot, V3 } from '../../lib/animation/types';
import { parentIn, ridesOn } from '../../lib/objectTree';
import { db } from '../viewer/db';
import { shortestItemSet } from '../viewer/shortestItemSet';
import { applyStateUpdates, refreshSelection } from '../viewer/viewer.actions';
import { animationDocActions } from './animationDoc.actions';
import { animationDocState } from './animationDoc.state';
import { animationUiState } from './animationUi.state';
import { activeScene, findObject, mapActiveScene, mapObject } from './docEdit';
import { objectRow } from './rows';
import { liveTimeNow, objectBaseAt, objectPivotPointOf, objectPoseNow, pivotOfObject } from './runtime';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function sameItems(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** More objects than this at once ask first. */
const MANY_OBJECTS = 50;

/** Tenths of a millimetre are plenty for a pivot point. */
function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4 || 0;
}

/** The active scene's object with exactly these items (and leave-outs),
 *  else null. */
export function objectWithItems(items: readonly string[], exclude: readonly string[] = []): AnimObject | null {
  return activeScene()?.objects.find((o) => sameItems(o.items, items) && sameItems(o.exclude ?? [], exclude)) ?? null;
}

/** A name not used by another object of the scene ("Pump", "Pump 2") nor by
 *  `taken` (names given in the same batch). */
export function freeName(name: string, taken: ReadonlySet<string> = new Set()): string {
  const used = new Set([...(activeScene()?.objects.map((o) => o.name) ?? []), ...taken]);
  if (!used.has(name)) {
    return name;
  }
  let n = 2;
  while (used.has(`${name} ${n}`)) {
    n++;
  }
  return `${name} ${n}`;
}

/** The active scene's object whose items are exactly the selection's (as
 *  + Object would name them), else null. */
async function objectOfSelection(): Promise<AnimObject | null> {
  const sel = await db.animActorFromSelection();
  if (!sel) {
    return null;
  }
  const set = await shortestItemSet(sel);
  return objectWithItems(sel.fullnames) ?? objectWithItems(set.items, set.exclude);
}

/** Where a new object with these items goes in the tree of the active
 *  scene: it rides on the smallest object its items are wholly inside, and
 *  the objects wholly inside it, that rode on the same one, ride on it
 *  instead (`adopt`). Either order of making them gives the same tree. */
export async function placeInTree(items: string[], exclude: string[]): Promise<{ parent?: string; adopt: string[] }> {
  const objects = activeScene()?.objects ?? [];
  if (objects.length === 0) {
    return { adopt: [] };
  }
  const relations = await db.animItemRelations(
    items,
    exclude,
    objects.map((o) => ({ id: o.id, fullnames: o.items, exclude: o.exclude ?? [] })),
  );
  const [above] = relations.filter((r) => r.relation === 'inside').sort((a, b) => a.items - b.items);
  const parent = above?.id;
  const adopt = relations
    .filter((r) => r.relation === 'contains')
    .map((r) => r.id)
    .filter((id) => objects.find((o) => o.id === id)?.parent === parent);
  return { ...(parent ? { parent } : {}), adopt };
}

/** Where `o`'s keys are applied under at T when it rides on `parent`
 *  (null: on nothing). */
function aboveWith(parent: AnimObject | null, T: number): Float64Array {
  return parent ? objectBaseAt(parent, T) : m4Identity(f64());
}

function f64(): Float64Array {
  return new Float64Array(16);
}

/** `o` riding on `parent` instead (null: on nothing), every key re-said so
 *  the object stands where it stood AT each key — between keys it now
 *  follows the new parent's motion instead of the old one's. */
function reParented(o: AnimObject, parent: AnimObject | null): AnimObject {
  const from = parentIn(activeScene()?.objects ?? [], o) ?? null;
  const pivotOf = pivotOfObject(o.id);
  const keys = o.keys.map((k) => {
    const q = pivotOf(k);
    const drawn = m4Multiply(aboveWith(from, k.t), poseMatrix(k, q, f64()), f64());
    const own = m4Multiply(m4InvertRigid(aboveWith(parent, k.t), f64()), drawn, f64());
    return { ...k, ...decomposeRigid(own, q) };
  });
  const { parent: _old, ...rest } = o;
  return { ...rest, ...(parent ? { parent: parent.id } : {}), keys };
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const objectsActions = {
  /** The selection as an object of the active scene (an object with the same
   *  items is reused), its items said the shortest way — a large node with a
   *  few parts deselected is that node minus those parts, not every node
   *  still selected under it. `key` gives a new one a key at the time slider
   *  holding where it stands. Made inside another object's items it rides
   *  on that object (a sub-object), and objects wholly inside it ride on it
   *  — nothing moves when that tree forms. Null without a selection. */
  async fromSelection(opts: { key: boolean }): Promise<string | null> {
    const sel = await db.animActorFromSelection();
    if (!sel) {
      toast.info('Select the items to animate first (in the 3D view or the Hierarchy).');
      return null;
    }
    const set = await shortestItemSet(sel);
    const existing = objectWithItems(sel.fullnames) ?? objectWithItems(set.items, set.exclude);
    if (existing) {
      animationUiState.set({ current: objectRow(existing.id), objectSelection: [existing.id] });
      return existing.id;
    }
    const T = liveTimeNow();
    const place = await placeInTree(set.items, set.exclude);
    const o: AnimObject = {
      id: newId('o'),
      name: freeName(set.name),
      items: set.items,
      ...(set.exclude.length > 0 ? { exclude: set.exclude } : {}),
      ...(place.parent ? { parent: place.parent } : {}),
      pivot: 'center',
      path: 'straight',
      keys: [],
    };
    const withKey = opts.key ? { ...o, keys: [keyHere(o, T, animationUiState.get().nextInterp ?? 'smooth')] } : o;
    animationDocActions.commit((d) =>
      mapActiveScene(d, (s) => ({
        ...s,
        objects: [...s.objects.map((x) => (place.adopt.includes(x.id) ? { ...x, parent: o.id } : x)), withKey],
      })),
    );
    // the selection is this object now (the gizmo shows on it at once — the
    // worker learns of it a moment later)
    animationUiState.set({ current: objectRow(o.id), picked: { kind: 'none' }, objectSelection: [o.id] });
    return o.id;
  },

  /** Many objects at once: one per child of each selected node
   *  (`children`; a node without children stands for itself) or one per
   *  selected node (`nodes`), each keyed at the time slider where it stands.
   *  Nodes that are an object already are skipped; many ask first. */
  async fromSelectionParts(mode: 'children' | 'nodes'): Promise<string[]> {
    const parts = await db.animSelectionParts(mode);
    if (parts.length === 0) {
      toast.info('Select the nodes first (in the Hierarchy or the 3D view).');
      return [];
    }
    if (parts.length > MANY_OBJECTS && !(await dialogs.confirm(`Make ${parts.length} objects, one per node?`))) {
      return [];
    }
    const T = liveTimeNow();
    const interp = animationUiState.get().nextInterp ?? 'smooth';
    const names = new Set<string>();
    const made: AnimObject[] = [];
    for (const p of parts) {
      const items = [p.fullname.toLowerCase()];
      if (objectWithItems(items)) {
        continue;
      }
      const name = freeName(p.name, names);
      names.add(name);
      const { parent } = await placeInTree(items, []);
      const o: AnimObject = {
        id: newId('o'),
        name,
        items,
        ...(parent ? { parent } : {}),
        pivot: 'center',
        path: 'straight',
        keys: [],
      };
      made.push({ ...o, keys: [keyHere(o, T, interp)] });
    }
    if (made.length === 0) {
      toast.info('Those nodes are objects already.');
      return [];
    }
    animationDocActions.commit((d) => mapActiveScene(d, (s) => ({ ...s, objects: [...s.objects, ...made] })));
    animationUiState.set({ current: objectRow(made[0].id), picked: { kind: 'none' } });
    toast.success(`${made.length} object${made.length === 1 ? '' : 's'} made.`);
    return made.map((o) => o.id);
  },

  /** Select the items of several objects (Ctrl / Shift on the Timeline). */
  async selectObjects(ids: readonly string[]): Promise<void> {
    const doc = animationDocState.get().doc;
    const lists = ids.flatMap((id) => {
      const o = findObject(doc, id)?.object;
      return o ? [{ fullnames: o.items, exclude: o.exclude ?? [] }] : [];
    });
    applyStateUpdates(await db.animSelectActors(lists));
    await refreshSelection();
  },

  /** The objects owning the selected items (most selected first). Empty when
   *  the selection is not (part of) an object: nothing is made on the fly —
   *  moving or keying loose items would fill the scene with objects nobody
   *  asked for. `hint` says so. */
  async forSelection(hint = true): Promise<string[]> {
    const owners = (await db.animSelectedActors()).filter((id) => activeScene()?.objects.some((o) => o.id === id));
    if (owners.length > 0) {
      return owners;
    }
    // an object made a moment ago is not captured by the worker yet: it is
    // still the selection it was made from
    const fresh = await objectOfSelection();
    if (fresh) {
      return [fresh.id];
    }
    if (hint) {
      toast.info('Make the selection an object first: Timeline → + Object.');
    }
    return [];
  },

  /** The same, else the selection as a new object (no key) — for a command
   *  that asks for an object by name, like + Callout. */
  async forSelectionOrNew(): Promise<string[]> {
    const owners = await objectsActions.forSelection(false);
    if (owners.length > 0) {
      return owners;
    }
    const made = await objectsActions.fromSelection({ key: false });
    return made ? [made] : [];
  },

  update(id: string, patch: Partial<Omit<AnimObject, 'id' | 'keys'>>, coalesce?: string): void {
    animationDocActions.commit((d) => mapObject(d, id, (o) => ({ ...o, ...patch })), coalesce);
  },

  rename(id: string, name: string): void {
    objectsActions.update(id, { name }, `object-name:${id}`);
  },

  /** The object's own pivot (what keys without one of their own are
   *  about). The object stays where every key has it: those keys are said
   *  about the new pivot. */
  setPivot(id: string, pivot: ObjectPivot): void {
    const from = objectPivotPointOf(id, findObject(animationDocState.get().doc, id)?.object.pivot ?? 'center');
    const to = objectPivotPointOf(id, pivot);
    animationDocActions.commit((d) =>
      mapObject(d, id, (o) => ({
        ...o,
        pivot,
        keys: o.keys.map((k) => (k.pivot ? k : { ...k, ...rePivot(k, from, to) })),
      })),
    );
  },

  /** The object's pivot = the point of it under the Transform ribbon's
   *  pivot where it is drawn now (the gizmo's pivot, kept on the key's
   *  while authoring); false when there is none. */
  pivotFromGizmo(id: string): boolean {
    const p = ribbonSelectionTransformState.get().pivot;
    const o = findObject(animationDocState.get().doc, id)?.object;
    if (!p || !o) {
      toast.info('Set a pivot first: Transform ribbon → Set pivot (drag it) or pick it from an item.');
      return false;
    }
    const r = m4TransformPoint(m4InvertRigid(objectPoseNow(o), new Float64Array(16)), [p[0], p[1], p[2]]);
    objectsActions.setPivot(id, [round4(r[0]), round4(r[1]), round4(r[2])]);
    return true;
  },

  /** What the object rides on (null: nothing). It stands where it stood at
   *  each of its keys; between them it follows the new parent. */
  setParent(id: string, parent: string | null): void {
    const objects = activeScene()?.objects ?? [];
    const o = objects.find((x) => x.id === id);
    const above = parent ? (objects.find((x) => x.id === parent) ?? null) : null;
    if (!o || (o.parent ?? null) === (above?.id ?? null)) {
      return;
    }
    if (above && (above.id === id || ridesOn(objects, above.id, id))) {
      toast.error('An object cannot ride on itself or on what rides on it.');
      return;
    }
    const next = reParented(o, above);
    animationDocActions.commit((d) => mapObject(d, id, () => next));
  },

  setPath(id: string, path: MotionPath): void {
    objectsActions.update(id, { path });
  },

  toggleMuted(id: string): void {
    const o = findObject(animationDocState.get().doc, id)?.object;
    if (o) {
      objectsActions.update(id, { muted: !o.muted });
    }
  },

  /** The object's items = the selection's, said the shortest way (every key
   *  stays). */
  async updateFromSelection(id: string): Promise<void> {
    const sel = await db.animActorFromSelection();
    if (!sel) {
      toast.info('Select the items the object should hold first.');
      return;
    }
    const set = await shortestItemSet(sel);
    animationDocActions.commit((d) =>
      mapObject(d, id, (o) => {
        const { exclude: _old, ...rest } = o;
        return { ...rest, items: set.items, ...(set.exclude.length > 0 ? { exclude: set.exclude } : {}) };
      }),
    );
    const leftOut = set.exclude.length > 0 ? `, ${set.exclude.length} left out` : '';
    toast.success(`${set.items.length} node(s) now in the object${leftOut} — its keys are kept.`);
  },

  /** Select the object's items in the 3D view and the Hierarchy. */
  async selectItems(id: string): Promise<void> {
    const o = findObject(animationDocState.get().doc, id)?.object;
    if (!o) {
      return;
    }
    applyStateUpdates(await db.animSelectActor(o.items, o.exclude ?? []));
    await refreshSelection();
  },

  /** Slide in from the time slider: hidden away (when nothing keys it
   *  before), it appears `distance` m off in `dir` and slides into place
   *  over `duration` s. */
  slideIn(id: string, opts: { dir: V3; distance: number; duration: number; interp: Interp }): void {
    const T = liveTimeNow();
    animationDocActions.commit((d) =>
      mapObject(d, id, (o) => ({
        ...o,
        keys: slideInKeys(
          o,
          T,
          opts.dir,
          Math.max(0, opts.distance),
          Math.max(0.05, opts.duration),
          opts.interp,
          pivotOfObject(o.id),
        ),
      })),
    );
  },

  /** Slide in with the Key panel's settings (side, distance, time). */
  slideInWithSettings(id: string): void {
    const s = animationUiState.get().slideIn;
    const dir = (SLIDE_DIRECTIONS.find((d) => d.value === s.dir) ?? SLIDE_DIRECTIONS[0]).dir;
    objectsActions.slideIn(id, { dir, distance: s.distance, duration: s.duration, interp: 'smooth' });
  },

  /** Remove an object and its row (its items stand where the model has
   *  them, or follow the object it rode on; its sub-objects are kept). */
  remove(id: string): void {
    const objects = activeScene()?.objects ?? [];
    const gone = objects.find((o) => o.id === id);
    // what rode on it rides on what it rode on, standing where it stood at
    // each of its keys
    const above = gone ? (parentIn(objects, gone) ?? null) : null;
    const handed = new Map(objects.filter((o) => o.parent === id).map((o) => [o.id, reParented(o, above)]));
    animationDocActions.commit((d) =>
      mapActiveScene(d, (s) => ({
        ...s,
        objects: s.objects.filter((o) => o.id !== id).map((o) => handed.get(o.id) ?? o),
      })),
    );
    if (handed.size > 0) {
      toast.info(
        `${handed.size} sub-object${handed.size === 1 ? '' : 's'} of "${gone?.name ?? ''}" kept — they no longer follow its motion.`,
      );
    }
    const ui = animationUiState.get();
    if (ui.current === objectRow(id)) {
      animationUiState.set({ current: null, picked: { kind: 'none' } });
    }
  },
};
