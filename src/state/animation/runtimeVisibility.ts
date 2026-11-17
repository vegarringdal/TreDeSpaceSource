// Instant visibility / opacity / colour and colour-rules sync (DESIGN.md ›
// Animation › Engine): the evaluated state is diffed against what was last
// sent, and only changes go to the worker — a handful of calls per scene.
// The rules go first (they rebase the objects). One call in flight at a
// time; a newer frame replaces whatever was queued.

import { specsForRules } from '../../components/panels/multi-color/multiColor.actions';
import type { FrameState } from '../../lib/animation/evaluate';
import type { RulesFrame } from '../../lib/animation/rules';
import type { RuleSet } from '../../lib/animation/types';
import { packHex } from '../../lib/color/hexColor';
import type { ColorRuleSpec } from '../../lib/modeldb/colorRules';
import type { StateUpdate } from '../../lib/modeldb/dbState';
import type { ActorColorLayer } from '../../lib/modeldb/lookBlend';
import { db } from '../viewer/db';
import { applyStateUpdates } from '../viewer/viewer.actions';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

interface Wanted {
  visible: Map<string, boolean | null>;
  opacity: Map<string, number | null>;
  colors: Map<string, string | null>;
  look: RulesFrame | null;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const CLEAN = '∅';

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

let sentVisible = new Map<string, boolean | null>();
let sentOpacity = new Map<string, number | null>();
let sentColors = new Map<string, string | null>();
let sentLook = CLEAN;
/** content key → the rules' worker specs (store scopes resolved once) */
const specCache = new Map<string, Promise<ColorRuleSpec[]>>();
/** a rule set → its content hash (rule sets live as long as the doc
 *  revision, so a frame never re-serialises its rules) */
const contentKeys = new WeakMap<RuleSet, string>();
/** callers waiting for the worker to have taken everything queued */
let syncedWaiters: (() => void)[] = [];
let inFlight = false;
/** Bumped by every reset; a flush started before it is stale. */
let generation = 0;
let queued: Wanted | null = null;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function diff<T>(
  want: ReadonlyMap<string, T | null>,
  sent: ReadonlyMap<string, T | null>,
): { actor: string; value: T | null }[] {
  const out: { actor: string; value: T | null }[] = [];
  for (const [actor, value] of want) {
    if (sent.get(actor) !== value) {
      out.push({ actor, value });
    }
  }
  return out;
}

/** FNV-1a of a string, as 8 hex digits — a rule set's content key. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A rule set's key is its content: edited rules are re-run, and the same
 *  rules in many keys share one worker result. */
function contentKey(v: RuleSet): string {
  let k = contentKeys.get(v);
  if (k === undefined) {
    k = hashText(JSON.stringify([v.mode, v.rules]));
    contentKeys.set(v, k);
  }
  return k;
}

function lookSignature(look: RulesFrame | null): string {
  return look ? contentKey(look.value) : CLEAN;
}

function colorLayer(c: string | null | undefined): ActorColorLayer | null {
  return c ? { from: null, to: packHex(c), mix: 1 } : null;
}

async function sendLook(look: RulesFrame | null): Promise<StateUpdate[]> {
  let to: { key: string; specs: ColorRuleSpec[]; mode: RuleSet['mode'] } | null = null;
  if (look) {
    const key = contentKey(look.value);
    let specs = specCache.get(key);
    if (!specs) {
      specs = specsForRules(look.value.rules);
      specCache.set(key, specs);
    }
    to = { key, specs: await specs, mode: look.value.mode };
  }
  return db.animSetLook({ to, from: null, mix: 1 });
}

async function flush(): Promise<void> {
  while (queued) {
    const next = queued;
    queued = null;
    // a reset (session re-entered or left) while this runs makes it stale:
    // the worker was restored, so nothing collected here may land
    const gen = generation;
    const look = lookSignature(next.look);
    const vis = diff(next.visible, sentVisible);
    const op = diff(next.opacity, sentOpacity);
    const colors = diff(next.colors, sentColors);
    if (look === sentLook && vis.length === 0 && op.length === 0 && colors.length === 0) {
      continue;
    }
    inFlight = true;
    try {
      const updates: StateUpdate[][] = [];
      if (look !== sentLook) {
        updates.push(await sendLook(next.look));
      }
      if (colors.length && gen === generation) {
        updates.push(await db.animSetColor(colors.map((c) => ({ actor: c.actor, color: colorLayer(c.value) }))));
      }
      if (vis.length && gen === generation) {
        updates.push(await db.animSetVisibility(vis.map((c) => ({ actor: c.actor, visible: c.value }))));
      }
      if (op.length && gen === generation) {
        updates.push(await db.animSetOpacity(op.map((c) => ({ actor: c.actor, value: c.value }))));
      }
      if (gen !== generation) {
        continue; // stale: drop it, go on with anything queued since
      }
      for (const u of updates) {
        applyStateUpdates(u);
      }
      sentLook = look;
      sentColors = next.colors;
      sentVisible = next.visible;
      sentOpacity = next.opacity;
    } finally {
      inFlight = false;
    }
  }
  const waiters = syncedWaiters;
  syncedWaiters = [];
  for (const done of waiters) {
    done();
  }
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Queue this frame's instant state for every object of the scene (objects
 *  without a key go back to how the model shows them — null). */
export function syncVisibility(frame: FrameState, objects: readonly string[]): void {
  const visible = new Map<string, boolean | null>();
  const opacity = new Map<string, number | null>();
  const colors = new Map<string, string | null>();
  for (const o of objects) {
    visible.set(o, frame.visible.get(o) ?? null);
    opacity.set(o, frame.opacity.get(o) ?? null);
    colors.set(o, frame.colors.get(o) ?? null);
  }
  queued = { visible, opacity, colors, look: frame.look };
  if (!inFlight) {
    void flush();
  }
}

/** Resolves once every queued frame state is in the worker and uploaded —
 *  a video frame waits for it. */
export function whenVisibilitySynced(): Promise<void> {
  if (!inFlight && !queued) {
    return Promise.resolve();
  }
  return new Promise((resolve) => syncedWaiters.push(resolve));
}

/** Forget what was sent (session enter / exit: the worker restored or reset). */
export function resetVisibilitySync(): void {
  generation++;
  sentVisible = new Map();
  sentOpacity = new Map();
  sentColors = new Map();
  // the worker starts every session from the clean scene
  sentLook = CLEAN;
  specCache.clear();
  queued = null;
  const waiters = syncedWaiters;
  syncedWaiters = [];
  for (const done of waiters) {
    done();
  }
}
