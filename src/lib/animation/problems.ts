// -----------------------------------------------------------------------------
// the Problems list (DESIGN.md › Animation › Evaluation)
// -----------------------------------------------------------------------------
// What may not play as meant: objects whose items are missing from the
// loaded models, items in two objects, objects moving while hidden, and
// overlays whose design or instance is missing. Pure.

import { STEP_CARD_PREFIX, segmentMoves, stepHasCard } from './evaluate';
import type { AnimationDoc, AnimObject, Scene } from './types';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** Items `object` names that `owner` (earlier in the scene) already owns: an
 *  item moves with one object only, so they follow the owner. */
export interface SharedItems {
  object: string;
  owner: string;
  items: number;
}

export type Problem =
  | { kind: 'unresolvedObject'; object: string; missing: number }
  | ({ kind: 'sharedItems' } & SharedItems)
  | { kind: 'hiddenMove'; object: string; t: number }
  | { kind: 'missingComponent'; instance: string }
  | { kind: 'missingInstance'; callout: string; instance: string }
  /** a callout hanging from an object the scene no longer has (hidden) */
  | { kind: 'missingAnchor'; callout: string; object: string };

/** What the check knows beyond the doc: unresolved item counts per object,
 *  the items objects share, and the user's library design ids. */
export interface ProblemInputs {
  unresolved: ReadonlyMap<string, number>;
  shared: readonly SharedItems[];
  libraryComponents: ReadonlySet<string>;
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** The first key time from which the object moves while hidden, else null. */
function hiddenMoveAt(o: AnimObject): number | null {
  let visible = true;
  let opacity = 1;
  for (const [i, k] of o.keys.entries()) {
    visible = k.visible ?? visible;
    opacity = k.opacity ?? opacity;
    const next = o.keys[i + 1];
    const moves = next !== undefined && segmentMoves(k, next);
    // a key that shows the object again lands it visibly — only a segment
    // that stays hidden all the way counts
    if (moves && (!visible || opacity === 0) && next.visible !== true) {
      return k.t;
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Every problem of one scene, in a stable order. */
export function checkScene(doc: AnimationDoc, scene: Scene, inputs: ProblemInputs): Problem[] {
  const problems: Problem[] = [];
  const objects = new Set(scene.objects.map((o) => o.id));
  for (const [object, missing] of inputs.unresolved) {
    if (missing > 0 && objects.has(object)) {
      problems.push({ kind: 'unresolvedObject', object, missing });
    }
  }
  for (const s of inputs.shared) {
    if (objects.has(s.object)) {
      problems.push({ kind: 'sharedItems', ...s });
    }
  }
  for (const o of scene.objects) {
    const t = o.muted ? null : hiddenMoveAt(o);
    if (t !== null) {
      problems.push({ kind: 'hiddenMove', object: o.id, t });
    }
  }
  const known = (id: string) => inputs.libraryComponents.has(id) || doc.overlayComponents.some((c) => c.id === id);
  const instances = new Map(doc.overlayInstances.map((i) => [i.id, i]));
  for (const c of scene.callouts) {
    const inst = instances.get(c.instance);
    if (!inst) {
      problems.push({ kind: 'missingInstance', callout: c.id, instance: c.instance });
    } else if (!known(inst.component)) {
      problems.push({ kind: 'missingComponent', instance: inst.id });
    } else if (inst.anchor.kind === 'object' && !objects.has(inst.anchor.object)) {
      problems.push({ kind: 'missingAnchor', callout: c.id, object: inst.anchor.object });
    }
  }
  for (const s of scene.steps) {
    const component = s.card ? s.card.component : stepHasCard(scene, s.card) ? scene.stepCard?.component : null;
    if (component && !known(component)) {
      problems.push({ kind: 'missingComponent', instance: `${STEP_CARD_PREFIX}${s.id}` });
    }
  }
  return problems;
}

/** One-line description for the Problems list. */
export function describeProblem(p: Problem, name: (id: string) => string): string {
  switch (p.kind) {
    case 'unresolvedObject':
      return `${name(p.object)}: ${p.missing} item(s) not found in the loaded models`;
    case 'sharedItems':
      return `${name(p.object)} shares ${p.items} item(s) with ${name(p.owner)} — they move with ${name(p.owner)} only`;
    case 'hiddenMove':
      return `${name(p.object)} moves while hidden from ${p.t.toFixed(1)} s`;
    case 'missingComponent':
      return `Overlay ${name(p.instance)} uses a design that is not in the file or the library`;
    case 'missingInstance':
      return `Callout ${name(p.callout)} shows an overlay that is not in the file`;
    case 'missingAnchor':
      return `Callout ${name(p.callout)} hangs from an object that is gone, so it is hidden — anchor it again`;
  }
}
