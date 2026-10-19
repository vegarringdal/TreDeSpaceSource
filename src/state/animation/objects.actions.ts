// Objects (DESIGN.md › Animation › Authoring): made from the selection —
// named after the selected node — with one row of keys each. Update from
// selection swaps the items and keeps every key; the pivot and the path
// belong to the object. Every edit goes through commit (undoable).

import { toast } from '@treDeSpaceUI/widgets';
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { ribbonSelectionTransformState } from '../../components/panels/ribbon-selection-transform/ribbonSelectionTransform.state';
import { m4InvertRigid, m4TransformPoint } from '../../lib/animation/interp';
import { newId } from '../../lib/animation/io';
import { keyHere, rePivot, SLIDE_DIRECTIONS, slideInKeys } from '../../lib/animation/keyRows';
import type { AnimObject, Interp, MotionPath, ObjectPivot, V3 } from '../../lib/animation/types';
import { db } from '../viewer/db';
import { applyStateUpdates, refreshSelection } from '../viewer/viewer.actions';
import { animationDocActions } from './animationDoc.actions';
import { animationDocState } from './animationDoc.state';
import { animationUiState } from './animationUi.state';
import { activeScene, findObject, mapActiveScene, mapObject } from './docEdit';
import { objectRow } from './rows';
import { liveTimeNow, objectPivotPointOf, objectPoseNow, pivotOfObject } from './runtime';

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

/** The active scene's object with exactly these items, else null. */
function objectWithItems(items: readonly string[]): AnimObject | null {
  return activeScene()?.objects.find((o) => sameItems(o.items, items)) ?? null;
}

/** A name not used by another object of the scene ("Pump", "Pump 2") nor by
 *  `taken` (names given in the same batch). */
function freeName(name: string, taken: ReadonlySet<string> = new Set()): string {
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

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const objectsActions = {
  /** The selection as an object of the active scene (an object with the same
   *  items is reused); `key` gives a new one a key at the time slider
   *  holding where it stands. Null without a selection. */
  async fromSelection(opts: { key: boolean }): Promise<string | null> {
    const sel = await db.animActorFromSelection();
    if (!sel) {
      toast.info('Select the items to animate first (in the 3D view or the Hierarchy).');
      return null;
    }
    const existing = objectWithItems(sel.fullnames);
    if (existing) {
      animationUiState.set({ current: objectRow(existing.id) });
      return existing.id;
    }
    const T = liveTimeNow();
    const o: AnimObject = {
      id: newId('o'),
      name: freeName(sel.name),
      items: sel.fullnames,
      pivot: 'center',
      path: 'straight',
      keys: [],
    };
    const withKey = opts.key ? { ...o, keys: [keyHere(o, T, animationUiState.get().nextInterp ?? 'smooth')] } : o;
    animationDocActions.commit((d) => mapActiveScene(d, (s) => ({ ...s, objects: [...s.objects, withKey] })));
    animationUiState.set({ current: objectRow(o.id), picked: { kind: 'none' } });
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
      const o: AnimObject = { id: newId('o'), name, items, pivot: 'center', path: 'straight', keys: [] };
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

  /** The objects owning the selected items (most selected first), else the
   *  selection as a new object (no key). Empty without a selection. */
  async forSelection(): Promise<string[]> {
    const owners = (await db.animSelectedActors()).filter((id) => activeScene()?.objects.some((o) => o.id === id));
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

  setPath(id: string, path: MotionPath): void {
    objectsActions.update(id, { path });
  },

  toggleMuted(id: string): void {
    const o = findObject(animationDocState.get().doc, id)?.object;
    if (o) {
      objectsActions.update(id, { muted: !o.muted });
    }
  },

  /** The object's items = the selection's (every key stays). */
  async updateFromSelection(id: string): Promise<void> {
    const sel = await db.animActorFromSelection();
    if (!sel) {
      toast.info('Select the items the object should hold first.');
      return;
    }
    animationDocActions.commit((d) =>
      mapObject(d, id, (o) => {
        const { exclude: _old, ...rest } = o;
        return { ...rest, items: sel.fullnames };
      }),
    );
    toast.success(`${sel.fullnames.length} node(s) now in the object — its keys are kept.`);
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

  /** Remove an object and its row (its items stand where the model has them). */
  remove(id: string): void {
    animationDocActions.commit((d) =>
      mapActiveScene(d, (s) => ({
        ...s,
        objects: s.objects.filter((o) => o.id !== id),
      })),
    );
    const ui = animationUiState.get();
    if (ui.current === objectRow(id)) {
      animationUiState.set({ current: null, picked: { kind: 'none' } });
    }
  },
};
