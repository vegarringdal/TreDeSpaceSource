// Transform objects (DESIGN.md › Transform objects): made from the selection
// with New Object — a selection inside another object rides on it — and moved
// by the Transform ribbon, the gizmo or typed numbers. Every edit goes
// through commit (undoable); the worker is told through transformSync.

import { toast } from '@treDeSpaceUI/widgets';
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { m4Multiply, m4TransformPoint } from '../../lib/animation/interp';
import { pivotThrough } from '../../lib/animation/pivots';
import { downloadText } from '../../lib/download';
import type { Result } from '../../lib/result';
import { newTransformId, parseTransformDoc, serializeTransformDoc } from '../../lib/transform/io';
import {
  applyWorld,
  identityMatrix,
  invertAffine,
  isIdentityPose,
  parentMatrix,
  pivotPoint,
  poseMatrix,
  reParent,
  rePivot,
  ridesOn,
  roundPose,
  worldMatrices,
  worldPivot,
} from '../../lib/transform/pose';
import {
  IDENTITY_POSE,
  type ModelRef,
  type Pose,
  type TransformObject,
  type TransformPivot,
  type V3,
} from '../../lib/transform/types';
import { playerState } from '../animation/player.state';
import { db } from '../viewer/db';
import { selectionState } from '../viewer/selection.state';
import { shortestItemSet, tidyItemSet } from '../viewer/shortestItemSet';
import { applyStateUpdates, refreshSelection, setGizmoCommitHandler } from '../viewer/viewer.actions';
import { transformState } from './transform.state';
import { forgetTransformSync, requestTransformSync, restBoxes } from './transformSync';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** One pool slot per object; well under the committed half of the pool. */
export const MAX_TRANSFORM_OBJECTS = 4096;

/** Edits with the same coalesce key this close together are one undo step
 *  (typing a number, a held nudge key). */
const COALESCE_MS = 800;

const UNDO_MAX_STEPS = 200;

/** A job on the selection that is still running after this long gets the
 *  working dialog (a small selection never shows it). */
const WORKING_AFTER_MS = 250;

const WORKING_TITLE = 'Transform objects';

const SAVE_FILE_NAME = 'transform-objects.json';

/** What a move without a current object answers. */
export const NEED_OBJECT = 'Make the selection an object first: Transform ribbon → New Object.';
const IN_ANIMATION = 'Transform objects rest while animating — leave the animation to move them.';

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

const undoStack: TransformObject[][] = [];
const redoStack: TransformObject[][] = [];
let lastCoalesce = '';
let lastCommitAt = 0;
let pivotMemo: { state: unknown; point: V3 | null } = { state: null, point: null };

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function find(id: string | null): TransformObject | null {
  return (id && transformState.get().objects.find((o) => o.id === id)) || null;
}

function current(): TransformObject | null {
  return find(transformState.get().currentId);
}

/** Animation mode starts clean and owns the slots: edits wait. */
function resting(): boolean {
  if (playerState.get().status === 'off') {
    return false;
  }
  toast.info(IN_ANIMATION);
  return true;
}

function specKey(objects: readonly TransformObject[]): string {
  return JSON.stringify(objects.map((o) => [o.id, o.items, o.exclude ?? [], o.models ?? []]));
}

/** The object list becomes `next` (one undo step; `coalesce` joins quick
 *  edits of one field into a single step). */
function commit(next: TransformObject[], coalesce = ''): Promise<void> {
  const prev = transformState.get().objects;
  const now = Date.now();
  const joins = coalesce !== '' && coalesce === lastCoalesce && now - lastCommitAt < COALESCE_MS;
  if (!joins) {
    undoStack.push(prev);
    if (undoStack.length > UNDO_MAX_STEPS) {
      undoStack.shift();
    }
  }
  redoStack.length = 0;
  lastCoalesce = coalesce;
  lastCommitAt = now;
  return install(prev, next);
}

/** Show `next` and tell the worker what changed. */
function install(prev: readonly TransformObject[], next: TransformObject[]): Promise<void> {
  transformState.set({ objects: next, undoDepth: undoStack.length, redoDepth: redoStack.length });
  return requestTransformSync(specKey(prev) === specKey(next) ? 'pose' : 'items');
}

function mapObject(id: string, fn: (o: TransformObject) => TransformObject): TransformObject[] {
  return transformState.get().objects.map((o) => (o.id === id ? fn(o) : o));
}

function pivotOf(o: TransformObject): V3 {
  return pivotPoint(o.pivot, restBoxes().get(o.id));
}

/** A name no other object has ("Pump", "Pump 2"). */
function freeName(name: string): string {
  const used = new Set(transformState.get().objects.map((o) => o.name));
  if (!used.has(name)) {
    return name;
  }
  let n = 2;
  while (used.has(`${name} ${n}`)) {
    n++;
  }
  return `${name} ${n}`;
}

/** Run `job` under the working dialog once it has taken a moment: naming and
 *  resolving a large selection keeps the worker busy for a while. */
async function withWorking<T>(label: string, job: () => Promise<T>): Promise<T> {
  let isShown = false;
  const timer = window.setTimeout(() => {
    isShown = true;
    dialogs.loading(label, WORKING_TITLE);
  }, WORKING_AFTER_MS);
  try {
    return await job();
  } finally {
    clearTimeout(timer);
    if (isShown) {
      dialogs.hideLoading();
    }
  }
}

/** `a` plus the files of `b` it does not have yet. An object without files
 *  (saved before they were kept) looks in every model and stays that way. */
function withModels(a: readonly ModelRef[] | undefined, b: readonly ModelRef[]): ModelRef[] | undefined {
  if (!a) {
    return undefined;
  }
  const key = (r: ModelRef) => JSON.stringify([r.store, r.group, r.name]);
  const have = new Set(a.map(key));
  return [...a, ...b.filter((r) => !have.has(key(r)))];
}

function names(ids: readonly string[]): string {
  return ids.map((id) => `"${find(id)?.name ?? id}"`).join(', ');
}

function translation(v: V3): Float64Array {
  const g = new Float64Array(16);
  g[0] = g[5] = g[10] = g[15] = 1;
  g[12] = v[0];
  g[13] = v[1];
  g[14] = v[2];
  return g;
}

/** `linear` (3×3, column-major in a 4×4) applied about world point `c`. */
function aboutPoint(linear: Float64Array, c: V3): Float64Array {
  const moved = m4TransformPoint(linear, c);
  const g = Float64Array.from(linear);
  g[12] = c[0] - moved[0];
  g[13] = c[1] - moved[1];
  g[14] = c[2] - moved[2];
  g[15] = 1;
  return g;
}

/** A turn of `degrees` about world axis `axis`. */
function axisTurn(axis: 0 | 1 | 2, degrees: number): Float64Array {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const a = (axis + 1) % 3;
  const b = (axis + 2) % 3;
  const g = new Float64Array(16);
  g[0] = g[5] = g[10] = g[15] = 1;
  g[a * 4 + a] = c;
  g[a * 4 + b] = s;
  g[b * 4 + a] = -s;
  g[b * 4 + b] = c;
  return g;
}

// -----------------------------------------------------------------------------
// read
// -----------------------------------------------------------------------------

/** Where the current object's pivot is drawn (world) — what the gizmo sits
 *  on and the ribbon turns about; null without a current object. */
export function currentPivotWorld(): V3 | null {
  const s = transformState.get();
  if (pivotMemo.state === s) {
    return pivotMemo.point;
  }
  const o = current();
  const point = o ? worldPivot(o, pivotOf(o), parentMatrix(s.objects, restBoxes(), o.id)) : null;
  pivotMemo = { state: s, point };
  return point;
}

// -----------------------------------------------------------------------------
// new object
// -----------------------------------------------------------------------------

/** The selection as a new object, its items said the shortest way (a
 *  group minus a few nodes when that is shorter). One with the same items
 *  is picked instead; a selection INSIDE an object rides on it (the innermost one);
 *  objects wholly inside the selection ride on the new one. A selection
 *  that only partly shares items with an object is refused — an item
 *  cannot follow two poses. Resolves the object's id, null when none. */
async function makeFromSelection(): Promise<string | null> {
  if (resting()) {
    return null;
  }
  const sel = await db.animActorFromSelection();
  if (!sel) {
    toast.info('Select the items to move first (in the 3D view or the Hierarchy).');
    return null;
  }
  const s = transformState.get();
  if (s.objects.length >= MAX_TRANSFORM_OBJECTS) {
    toast.error(`No more than ${MAX_TRANSFORM_OBJECTS} transform objects.`);
    return null;
  }
  const set = await shortestItemSet(sel, sel.models);
  const relations = await db.transformRelations(set.items, set.exclude, sel.models);
  const idsOf = (r: string) => relations.filter((x) => x.relation === r).map((x) => x.id);
  const [same] = idsOf('same');
  if (same) {
    transformState.set({ currentId: same });
    toast.info(`That selection is the object ${names([same])} already.`);
    return same;
  }
  const partly = idsOf('overlap');
  if (partly.length > 0) {
    toast.error(
      `Part of this selection belongs to ${names(partly)}. Select inside the object, or all of it, and try again.`,
    );
    return null;
  }
  const size = (id: string) => s.info[id]?.items ?? Infinity;
  const [parent] = idsOf('inside').sort((a, b) => size(a) - size(b));
  const inside = new Set(idsOf('contains'));
  const made: TransformObject = {
    id: newTransformId(),
    name: freeName(set.name),
    items: set.items,
    ...(set.exclude.length > 0 ? { exclude: set.exclude } : {}),
    models: sel.models,
    ...(parent ? { parent } : {}),
    pivot: { at: 'center' },
    move: [...IDENTITY_POSE.move],
    rotate: [...IDENTITY_POSE.rotate],
    scale: [...IDENTITY_POSE.scale],
  };
  const adopted = s.objects.map((o) => (inside.has(o.id) && o.parent === parent ? { ...o, parent: made.id } : o));
  transformState.set({ currentId: made.id, lastCurrentId: made.id });
  await commit([...adopted, made]);
  return made.id;
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const transformActions = {
  /** New Object: the selection as an object (see makeFromSelection), under
   *  the working dialog when it takes a moment. */
  newFromSelection(): Promise<string | null> {
    return withWorking('Making the object…', makeFromSelection);
  },

  /** Remove an object: its own items go back under what it rode on; what
   *  rode on it stays where it is drawn and rides on that instead. */
  remove(id: string): void {
    const s = transformState.get();
    const gone = find(id);
    if (!gone || resting()) {
      return;
    }
    const boxes = restBoxes();
    const world = worldMatrices(s.objects, boxes);
    const from = world.get(id);
    const to = parentMatrix(s.objects, boxes, id, world);
    const next = s.objects.flatMap((o): TransformObject[] => {
      if (o.id === id) {
        return [];
      }
      if (o.parent !== id || !from) {
        return [o];
      }
      const { parent: _old, ...rest } = o;
      return [{ ...rest, ...(gone.parent ? { parent: gone.parent } : {}), ...reParent(o, pivotOf(o), from, to) }];
    });
    void commit(next);
  },

  /** Remove every object (the items stand where the model has them). */
  clear(): void {
    if (transformState.get().objects.length === 0 || resting()) {
      return;
    }
    void commit([]);
  },

  rename(id: string, name: string): void {
    void commit(
      mapObject(id, (o) => ({ ...o, name })),
      `name:${id}`,
    );
  },

  /** Pick an object: the selection is replaced by its items — only in its
   *  own model files — which makes it the current object. */
  async select(id: string): Promise<void> {
    const o = find(id);
    if (!o) {
      return;
    }
    applyStateUpdates(await db.animSelectActor(o.items, o.exclude ?? [], o.models));
    await refreshSelection();
  },

  /** Add the selection to an object's items, or leave it out of them — a
   *  fix to what the object was made from. The item set is changed the
   *  least (a node under a group it already holds is not listed again; one
   *  taken out of such a group is left out by name) and then said the
   *  shortest way (tidyItemSet). Refused when the result
   *  would share items with another object only in part. The object's items
   *  are selected afterwards, so it is the current object again. */
  editItems(id: string, op: 'add' | 'remove'): Promise<boolean> {
    return withWorking(op === 'add' ? 'Adding the selection…' : 'Taking the selection out…', () =>
      transformActions.editItemsNow(id, op),
    );
  },

  /** editItems without the working dialog. */
  async editItemsNow(id: string, op: 'add' | 'remove'): Promise<boolean> {
    const o = find(id);
    if (!o || resting()) {
      return false;
    }
    const sel = await db.animActorFromSelection();
    if (!sel) {
      toast.info(`Select the items to ${op === 'add' ? 'add to' : 'take out of'} "${o.name}" first.`);
      return false;
    }
    const models = op === 'add' ? withModels(o.models, sel.models) : o.models;
    const edited = await db.animEditItemSet(o.items, o.exclude ?? [], sel.fullnames, op);
    const next = await tidyItemSet(edited.items, edited.exclude, models);
    if (next.items.length === 0) {
      toast.error(`That would leave "${o.name}" without items — delete the object instead.`);
      return false;
    }
    const clash = (await db.transformRelations(next.items, next.exclude, models))
      .filter((r) => r.id !== id && (r.relation === 'overlap' || r.relation === 'same'))
      .map((r) => r.id);
    if (clash.length > 0) {
      toast.error(`"${o.name}" would then share items with ${names(clash)} — an item cannot follow two objects.`);
      return false;
    }
    const { exclude: _old, models: _oldModels, ...rest } = o;
    const changed: TransformObject = {
      ...rest,
      items: next.items,
      ...(next.exclude.length > 0 ? { exclude: next.exclude } : {}),
      ...(models ? { models } : {}),
    };
    await commit(mapObject(id, () => changed));
    await transformActions.select(id);
    toast.success(op === 'add' ? `Added to "${o.name}".` : `Taken out of "${o.name}".`);
    return true;
  },

  /** Add / remove the selection on the object that was current last (hotkeys). */
  async editLastItems(op: 'add' | 'remove'): Promise<void> {
    const id = transformState.get().lastCurrentId;
    if (!find(id)) {
      toast.info('Pick the object first (select its items or its row), then select what to add or take out.');
      return;
    }
    await transformActions.editItems(id ?? '', op);
  },

  /** Typed pose values; `field` names what is being typed (one undo step). */
  setPose(id: string, patch: Partial<Pose>, field: string): void {
    if (resting()) {
      return;
    }
    void commit(
      mapObject(id, (o) => ({ ...o, ...roundPose({ move: o.move, rotate: o.rotate, scale: o.scale, ...patch }) })),
      `${field}:${id}`,
    );
  },

  /** What the object's numbers are about. It stays where it is drawn: the
   *  pose is said about the new pivot. */
  setPivot(id: string, pivot: TransformPivot): void {
    const o = find(id);
    if (!o || resting()) {
      return;
    }
    const box = restBoxes().get(id);
    const pose = rePivot(o, pivotPoint(o.pivot, box), pivotPoint(pivot, box));
    void commit(
      mapObject(id, (x) => ({ ...x, pivot, ...pose })),
      `pivot:${id}`,
    );
  },

  /** The current object's pivot put on world point `p` (the ribbon's Set
   *  Pivot → Lock, or an item's centre): written as the offset from the side
   *  its pivot names, so the list shows it. The object stays where it is
   *  drawn. False without a current object. */
  setCurrentPivotWorld(p: V3): boolean {
    const s = transformState.get();
    const o = current();
    if (!o || resting()) {
      return false;
    }
    const boxes = restBoxes();
    const drawn = m4Multiply(parentMatrix(s.objects, boxes, o.id), poseMatrix(o, pivotOf(o)), new Float64Array(16));
    const rest = m4TransformPoint(invertAffine(drawn), p);
    const pivot = pivotThrough(o.pivot, 'center', boxes.get(o.id), [0, 0, 0], rest) ?? { at: 'center' };
    transformActions.setPivot(o.id, pivot);
    return true;
  },

  /** The current object's pivot back on the side it names: a hand-placed
   *  offset is dropped (the ribbon's pivot Reset). */
  resetCurrentPivot(): void {
    const o = current();
    if (o?.pivot.offset) {
      transformActions.setPivot(o.id, { at: o.pivot.at });
    }
  },

  /** What the object rides on (null: nothing). It stays where it is drawn. */
  setParent(id: string, parent: string | null): void {
    const s = transformState.get();
    const o = find(id);
    if (!o || resting() || (o.parent ?? null) === parent) {
      return;
    }
    if (parent && (parent === id || ridesOn(s.objects, parent, id))) {
      toast.error('An object cannot ride on itself or on what rides on it.');
      return;
    }
    const boxes = restBoxes();
    const world = worldMatrices(s.objects, boxes);
    const from = parentMatrix(s.objects, boxes, id, world);
    const to = (parent ? world.get(parent) : undefined) ?? identityMatrix();
    const pose = reParent(o, pivotOf(o), from, to);
    const { parent: _old, ...rest } = o;
    void commit(mapObject(id, () => ({ ...rest, ...(parent ? { parent } : {}), ...pose })));
  },

  /** Show the object where the model has it, its pose kept. */
  toggleMuted(id: string): void {
    if (resting()) {
      return;
    }
    void commit(
      mapObject(id, (o) => {
        const { muted, ...rest } = o;
        return muted ? rest : { ...rest, muted: true };
      }),
    );
  },

  /** The object back where the model has it (it stays in the list). */
  resetPose(id: string): void {
    const o = find(id);
    if (!o || isIdentityPose(o) || resting()) {
      return;
    }
    void commit(mapObject(id, (x) => ({ ...x, ...roundPose(IDENTITY_POSE) })));
  },

  /** Mute / unmute the current object (hotkey). */
  toggleCurrentMuted(): void {
    const o = current();
    if (!o) {
      toast.info(NEED_OBJECT);
      return;
    }
    transformActions.toggleMuted(o.id);
  },

  /** Delete the current object (hotkey). */
  removeCurrent(): void {
    const o = current();
    if (!o) {
      toast.info(NEED_OBJECT);
      return;
    }
    transformActions.remove(o.id);
  },

  /** Reset the current object (the ribbon's Reset Object). */
  resetCurrent(): void {
    const o = current();
    if (!o) {
      toast.info(NEED_OBJECT);
      return;
    }
    transformActions.resetPose(o.id);
  },

  /** Every object back where the model has it, and every placement a loaded
   *  snapshot left on items no object holds. */
  async resetAll(): Promise<void> {
    if (resting()) {
      return;
    }
    const s = transformState.get();
    if (s.objects.some((o) => !isIdentityPose(o))) {
      void commit(s.objects.map((o) => ({ ...o, ...roundPose(IDENTITY_POSE) })));
    }
    await requestTransformSync('items', true);
  },

  // ---------------------------------------------------------------------------
  // moving the current object
  // ---------------------------------------------------------------------------

  /** World matrix `g` on top of where the current object is drawn (a gizmo
   *  drag, a ribbon step). False without a current object. */
  applyWorld(g: ArrayLike<number>): boolean {
    const s = transformState.get();
    const o = current();
    if (!o) {
      toast.info(NEED_OBJECT);
      return false;
    }
    if (resting()) {
      return false;
    }
    const pose = applyWorld(o, pivotOf(o), parentMatrix(s.objects, restBoxes(), o.id), g);
    void commit(mapObject(o.id, (x) => ({ ...x, ...pose })));
    return true;
  },

  /** `metres` along world axis `axis`. */
  nudge(axis: 0 | 1 | 2, metres: number): void {
    const v: V3 = [0, 0, 0];
    v[axis] = metres;
    transformActions.applyWorld(translation(v));
  },

  /** `degrees` about world axis `axis` through `pivot` (the ribbon's locked
   *  pivot), else through the object's own pivot. */
  rotate(axis: 0 | 1 | 2, degrees: number, pivot: V3 | null): void {
    const c = pivot ?? currentPivotWorld();
    if (c) {
      transformActions.applyWorld(aboutPoint(axisTurn(axis, degrees), c));
    } else {
      toast.info(NEED_OBJECT);
    }
  },

  /** Grow or shrink evenly so the selection's largest side changes by
   *  `metres`, about `pivot`, else the object's own pivot. */
  scaleBy(metres: number, pivot: V3 | null): void {
    const c = pivot ?? currentPivotWorld();
    const b = selectionState.get().bounds;
    if (!c || !b) {
      toast.info(NEED_OBJECT);
      return;
    }
    const largest = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1e-3);
    const f = Math.max(0.01, (largest + metres) / largest);
    const linear = new Float64Array(16);
    linear[0] = linear[5] = linear[10] = f;
    linear[15] = 1;
    transformActions.applyWorld(aboutPoint(linear, c));
  },

  // ---------------------------------------------------------------------------
  // history
  // ---------------------------------------------------------------------------

  undo(): void {
    const prev = undoStack.pop();
    if (!prev || resting()) {
      return;
    }
    const now = transformState.get().objects;
    redoStack.push(now);
    lastCoalesce = '';
    void install(now, prev);
  },

  redo(): void {
    const next = redoStack.pop();
    if (!next || resting()) {
      return;
    }
    const now = transformState.get().objects;
    undoStack.push(now);
    lastCoalesce = '';
    void install(now, next);
  },

  // ---------------------------------------------------------------------------
  // files
  // ---------------------------------------------------------------------------

  /** Save the object list to a downloaded JSON file. */
  downloadJson(): void {
    downloadText(SAVE_FILE_NAME, serializeTransformDoc(transformState.get().objects));
  },

  /** Load an object list, replacing the current one (undoable). */
  importJson(text: string): Result<number> {
    if (resting()) {
      return { error: { err: null, msg: IN_ANIMATION } };
    }
    const parsed = parseTransformDoc(text);
    if (!parsed.doc) {
      return { error: { err: null, msg: parsed.error ?? 'Not a transform objects file' } };
    }
    if (parsed.doc.objects.length > MAX_TRANSFORM_OBJECTS) {
      return { error: { err: null, msg: `The file holds more than ${MAX_TRANSFORM_OBJECTS} objects` } };
    }
    void commit(parsed.doc.objects);
    return { data: parsed.doc.objects.length };
  },

  /** A loaded snapshot replaced every transform: the placement is the
   *  snapshot's now, so the object list (and its history) is dropped. */
  dropForSnapshot(): void {
    undoStack.length = 0;
    redoStack.length = 0;
    forgetTransformSync();
    transformState.set({ objects: [], currentId: null, lastCurrentId: null, info: {}, undoDepth: 0, redoDepth: 0 });
  },
};

/** App startup: finished gizmo drags move the current object. (Registered
 *  from startup, not at import — viewer.actions may still be loading when
 *  this module is first read.) */
export function installTransformObjects(): void {
  setGizmoCommitHandler(async (g) => {
    if (transformActions.applyWorld(g)) {
      await requestTransformSync('pose');
    }
  });
}
