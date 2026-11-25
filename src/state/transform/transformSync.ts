// Transform objects ↔ worker (DESIGN.md › Transform objects). The object
// list lives on the main thread; this module sends the worker which items
// each object holds (after a change of items, or of the loaded models) and
// where each is drawn (after every change of a pose), in order, and keeps
// `currentId` on the object the selection is.

import { worldMatrices } from '../../lib/transform/pose';
import type { RestBoxes, TransformObject } from '../../lib/transform/types';
import { db, transfer } from '../viewer/db';
import { selectionState } from '../viewer/selection.state';
import { applyStateUpdates, getRenderer, refreshSelection } from '../viewer/viewer.actions';
import { type TransformObjectInfo, transformState } from './transform.state';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Models loading in a burst re-resolve the objects once. */
const MODELS_DEBOUNCE_MS = 150;

const MATRIX_FLOATS = 16;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

let chain: Promise<void> = Promise.resolve();
let wantItems = false;
let wantClearLoose = false;
let queued: Promise<void> | null = null;
/** the worker refused (animation mode owns the slots): send again at exit */
let heldForAnimation = false;
/** ids in the order the worker has them */
let sentIds: string[] = [];
let sentKey = '[]';
let modelsTimer = 0;
let lastModelsVersion = selectionState.get().modelsVersion;
let lastBounds = selectionState.get().bounds;
let lastCount = selectionState.get().count;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function specsOf(objects: readonly TransformObject[]) {
  return objects.map((o) => ({
    id: o.id,
    fullnames: o.items,
    exclude: o.exclude ?? [],
    ...(o.models ? { models: o.models } : {}),
  }));
}

function enqueue(job: () => Promise<void>): Promise<void> {
  chain = chain.then(job, job);
  return chain;
}

/** One 16-float world matrix per sent object, in the worker's order. */
function matricesFor(ids: readonly string[]): Float32Array<ArrayBuffer> {
  const s = transformState.get();
  const world = worldMatrices(s.objects, restBoxes());
  const out = new Float32Array(ids.length * MATRIX_FLOATS);
  ids.forEach((id, k) => {
    const w = world.get(id);
    if (w) {
      out.set(w, k * MATRIX_FLOATS);
    } else {
      out[k * MATRIX_FLOATS] = out[k * MATRIX_FLOATS + 5] = out[k * MATRIX_FLOATS + 10] = 1;
      out[k * MATRIX_FLOATS + 15] = 1;
    }
  });
  return out;
}

async function sendItems(clearLoose: boolean): Promise<boolean> {
  const objects = transformState.get().objects;
  const specs = specsOf(objects);
  const res = await db.transformObjectsSet(specs, clearLoose);
  if (res.refused) {
    heldForAnimation = true;
    wantClearLoose ||= clearLoose;
    return false;
  }
  sentIds = specs.map((s) => s.id);
  sentKey = JSON.stringify(specs);
  const info: Record<string, TransformObjectInfo> = {};
  for (const i of res.info) {
    info[i.id] = { items: i.items, missing: i.missing, restBox: i.restBox };
  }
  transformState.set({ info });
  await sendPoses();
  applyStateUpdates(res.updates);
  return true;
}

async function sendPoses(): Promise<void> {
  const matrices = matricesFor(sentIds);
  const pool = await db.transformObjectsPose(transfer(matrices, [matrices.buffer]));
  if (pool) {
    getRenderer()?.writeTransforms(pool);
  }
}

async function run(): Promise<void> {
  queued = null;
  const items = wantItems || JSON.stringify(specsOf(transformState.get().objects)) !== sentKey;
  const clearLoose = wantClearLoose;
  wantItems = wantClearLoose = false;
  if (!clearLoose && sentIds.length === 0 && transformState.get().objects.length === 0) {
    return;
  }
  if (items || clearLoose) {
    if (!(await sendItems(clearLoose))) {
      return;
    }
  } else {
    await sendPoses();
  }
  await refreshSelection();
}

async function syncCurrent(): Promise<void> {
  const s = transformState.get();
  const id = s.objects.length > 0 && selectionState.get().count > 0 ? await db.transformObjectForSelection() : null;
  transformState.set(id ? { currentId: id, lastCurrentId: id } : { currentId: null });
}

function onSelectionStore(): void {
  const s = selectionState.get();
  if (s.modelsVersion !== lastModelsVersion) {
    lastModelsVersion = s.modelsVersion;
    clearTimeout(modelsTimer);
    modelsTimer = window.setTimeout(() => void requestTransformSync('items'), MODELS_DEBOUNCE_MS);
  }
  if (s.bounds !== lastBounds || s.count !== lastCount) {
    lastBounds = s.bounds;
    lastCount = s.count;
    void enqueue(syncCurrent);
  }
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** The rest boxes the worker last reported, by object id. */
export function restBoxes(): RestBoxes {
  const out = new Map<string, number[]>();
  for (const [id, i] of Object.entries(transformState.get().info)) {
    if (i.restBox) {
      out.set(id, i.restBox);
    }
  }
  return out;
}

/** Send the object list to the worker: `items` re-resolves which items each
 *  object holds (and then the poses), `pose` only where they are drawn —
 *  a change of items is noticed either way. Requests made before the worker
 *  gets to them are sent as one. Resolves when the view shows the result. */
export function requestTransformSync(kind: 'items' | 'pose', clearLoose = false): Promise<void> {
  wantItems ||= kind === 'items';
  wantClearLoose ||= clearLoose;
  queued ??= enqueue(run);
  return queued;
}

/** Animation mode gave the slots back: send what was held meanwhile. */
export function resumeTransformSync(): void {
  if (heldForAnimation) {
    heldForAnimation = false;
    void requestTransformSync('items', wantClearLoose);
  }
}

/** The worker forgot every object (a snapshot replaced the transforms). */
export function forgetTransformSync(): void {
  sentIds = [];
  sentKey = '[]';
}

selectionState.subscribe(onSelectionStore);
