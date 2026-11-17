// -----------------------------------------------------------------------------
// animation looks: the scene-wide Set Color layer (DESIGN.md › Animation,
// D23–D26)
// -----------------------------------------------------------------------------
// Entering animation mode captures every model's colour/opacity/hidden band
// and clears it (the clean start, D24); exit restores it exactly. A look is a
// Set Color rule run made on that clean scene WITHOUT undo; its result is
// cached by key, so fading between two looks is a per-item blend of cached
// words — over only the items that differ, found once per pair.

import { applyColorRules, type ColorRuleSpec } from './colorRules';
import {
  type ColorUndoRecord,
  captureColorRuns,
  restoreColorRuns,
  restoreColorUndo,
  snapshotColorUndo,
} from './colorUndo';
import { HAS_COLOR_OVERRIDE, models } from './dbState';
import { type DirtyRanges, markDirty, markItems } from './hierarchyIndex';
import { blendLookWords, LOOK_BITS } from './lookBlend';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** One look as the runtime sends it: a content-keyed rule set. */
export interface LookSide {
  /** stable per content — the cache key */
  key: string;
  specs: ColorRuleSpec[];
  mode: 'reset' | 'append' | 'hide';
}

/** The look layer to show: `to` (null = clean) fading in from `from`. */
export interface LookRequest {
  to: LookSide | null;
  from: LookSide | null;
  mix: number;
}

/** One look's result per model: LOOK_BITS flags and colour per item. */
type Snapshot = Map<number, { flags: Uint32Array; color: Uint32Array }>;

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Look results kept (each costs 8 B per item of every model). */
const CACHE_LOOKS = 6;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

let scene: ColorUndoRecord[] | null = null;
/** the viewer's colour undo / redo stacks, set aside while the mode owns the
 *  colours: Set Color runs made meanwhile capture animation-mode states, and
 *  undoing them after exit would paint those back over the viewer's own */
let sceneUndo: ReturnType<typeof snapshotColorUndo> | null = null;
const cache = new Map<string, Snapshot>();
/** items that differ between the last blended pair, per model */
let pair: { key: string; diff: Map<number, Uint32Array> } | null = null;
/** the look layer currently shown */
let shown: { a: Snapshot | null; b: Snapshot | null; mix: number } = { a: null, b: null, mix: 1 };

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function liveModels(): number[] {
  const out: number[] = [];
  models.forEach((m, mi) => {
    if (!m.removed && m.itemCount > 0) {
      out.push(mi);
    }
  });
  return out;
}

/** Clear the look band of every item (the clean scene). */
function cleanAll(): void {
  for (const mi of liveModels()) {
    const s = models[mi].states;
    for (let i = 0; i < models[mi].itemCount; i++) {
      s[i * 2] = (s[i * 2] & ~LOOK_BITS) >>> 0;
    }
  }
}

/** Run a look's rules on the clean scene and keep the result (LRU). */
function snapshotOf(side: LookSide): Snapshot {
  const hit = cache.get(side.key);
  if (hit) {
    cache.delete(side.key);
    cache.set(side.key, hit);
    return hit;
  }
  cleanAll();
  applyColorRules(side.specs, side.mode, false, { undo: false });
  const snap: Snapshot = new Map();
  for (const mi of liveModels()) {
    const m = models[mi];
    const flags = new Uint32Array(m.itemCount);
    const color = new Uint32Array(m.itemCount);
    for (let i = 0; i < m.itemCount; i++) {
      flags[i] = m.states[i * 2] & LOOK_BITS;
      color[i] = m.states[i * 2 + 1];
    }
    snap.set(mi, { flags, color });
  }
  cache.set(side.key, snap);
  while (cache.size > CACHE_LOOKS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
  return snap;
}

/** Items whose words differ between two looks, per model. */
function diffOf(a: Snapshot | null, b: Snapshot | null): Map<number, Uint32Array> {
  const out = new Map<number, Uint32Array>();
  for (const mi of liveModels()) {
    const sa = a?.get(mi);
    const sb = b?.get(mi);
    const items: number[] = [];
    for (let i = 0; i < models[mi].itemCount; i++) {
      const fa = sa?.flags[i] ?? 0;
      const fb = sb?.flags[i] ?? 0;
      if (fa !== fb || (sa?.color[i] ?? 0) !== (sb?.color[i] ?? 0)) {
        items.push(i);
      }
    }
    if (items.length) {
      out.set(mi, Uint32Array.from(items));
    }
  }
  return out;
}

function wordsOf(mi: number, i: number, a: Snapshot | null, b: Snapshot | null, mix: number): [number, number] {
  const sa = a?.get(mi);
  const sb = b?.get(mi);
  return blendLookWords(
    sa?.flags[i] ?? 0,
    sa?.color[i] ?? 0,
    sb?.flags[i] ?? 0,
    sb?.color[i] ?? 0,
    models[mi].baseColor[i] ?? 0,
    mix,
  );
}

/** Write one item's blended look words into the live state. */
function writeItem(mi: number, i: number, a: Snapshot | null, b: Snapshot | null, mix: number): void {
  const m = models[mi];
  const [flags, color] = wordsOf(mi, i, a, b, mix);
  m.states[i * 2] = ((m.states[i * 2] & ~LOOK_BITS) | flags) >>> 0;
  if (flags & HAS_COLOR_OVERRIDE) {
    m.states[i * 2 + 1] = color;
  }
}

// -----------------------------------------------------------------------------
// public api (called by apiAnimation)
// -----------------------------------------------------------------------------

/** Enter: capture every model's look band, then clean the scene (D24). */
export function lookEnter(): number[] {
  scene = liveModels().map((mi) => captureColorRuns(mi));
  sceneUndo = snapshotColorUndo();
  cache.clear();
  pair = null;
  shown = { a: null, b: null, mix: 1 };
  cleanAll();
  return liveModels();
}

/** Exit: put the viewer's own colours back exactly. */
export function lookExit(): number[] {
  const touched: number[] = [];
  for (const rec of scene ?? []) {
    const m = models[rec.model];
    if (m && !m.removed) {
      restoreColorRuns(rec);
      touched.push(rec.model);
    }
  }
  if (sceneUndo) {
    restoreColorUndo(sceneUndo);
  }
  lookReset();
  return touched;
}

/** Forget everything without restoring (the models were cleared). */
export function lookReset(): void {
  scene = null;
  sceneUndo = null;
  cache.clear();
  pair = null;
  shown = { a: null, b: null, mix: 1 };
}

/** The look layer's words for one item (LOOK_BITS flags, colour) — the base
 *  an actor's own keys are laid over (D25). */
export function lookWordsFor(mi: number, i: number): [number, number] {
  return wordsOf(mi, i, shown.a, shown.b, shown.mix);
}

/** Show a look (blend). Returns the item ranges whose state words changed;
 *  the caller re-applies the actors' own keys on top. */
export function setLook(req: LookRequest): DirtyRanges {
  const dirty: DirtyRanges = new Map();
  if (!scene) {
    return dirty;
  }
  // a cache miss re-runs rules on the live words, so everything is rewritten
  const ran = (req.from !== null && !cache.has(req.from.key)) || (req.to !== null && !cache.has(req.to.key));
  const a = req.from ? snapshotOf(req.from) : null;
  const b = req.to ? snapshotOf(req.to) : null;
  const pairKey = `${req.from?.key ?? '∅'}|${req.to?.key ?? '∅'}`;
  shown = { a, b, mix: req.mix };
  // a new pair rewrites every item once; within one fade only the items
  // that differ between the two looks change
  if (ran || pair === null || pair.key !== pairKey) {
    pair = { key: pairKey, diff: diffOf(a, b) };
    for (const mi of liveModels()) {
      for (let i = 0; i < models[mi].itemCount; i++) {
        writeItem(mi, i, a, b, req.mix);
      }
      markDirty(dirty, mi, 0, models[mi].itemCount);
    }
    return dirty;
  }
  for (const [mi, items] of pair.diff) {
    for (const i of items) {
      writeItem(mi, i, a, b, req.mix);
    }
    markItems(dirty, mi, items); // diff items are ascending
  }
  return dirty;
}
