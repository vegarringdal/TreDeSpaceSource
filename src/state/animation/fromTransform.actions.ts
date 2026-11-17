// Transform objects → animation objects (DESIGN.md › Transform objects ›
// To animation). A transform object placed and pivoted in the Transform
// layout becomes an object of the active scene with the same items, pivot
// and place in the tree, and a first key at 0 s holding its pose — so the
// animation starts from what was set up, with nothing to redo. A copy, not a
// link: later changes to the transform object do not follow.

import { toast } from '@treDeSpaceUI/widgets';
import { newId } from '../../lib/animation/io';
import type { AnimObject, ObjectPivot } from '../../lib/animation/types';
import { ridersOf, treeOrder } from '../../lib/objectTree';
import { pivotPoint } from '../../lib/transform/pose';
import type { TransformObject } from '../../lib/transform/types';
import { transformState } from '../transform/transform.state';
import { animationDocActions } from './animationDoc.actions';
import { activeScene, mapActiveScene } from './docEdit';
import { freeName, objectWithItems, placeInTree } from './objects.actions';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Where the transform pose lands: the first frame. */
const FIRST_KEY_S = 0;

/** A scale this far from 1 is a scale (animation is rigid: it is dropped). */
const SCALED_MIN = 5e-4;

/** Tenths of a millimetre are plenty for a pivot point. */
const PIVOT_ROUND = 1e4;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

interface ItemSet {
  items: string[];
  exclude: string[];
}

/** What the animation object holds. Alone (`subObjects` left behind), what
 *  rides on it is left out — and what those leave out themselves comes back,
 *  since it is the container's. */
function itemsOf(o: TransformObject, leftBehind: readonly TransformObject[]): ItemSet {
  const items = new Set(o.items);
  const exclude = new Set(o.exclude ?? []);
  for (const sub of leftBehind) {
    for (const name of sub.items) {
      exclude.add(name);
    }
    for (const name of sub.exclude ?? []) {
      items.add(name);
    }
  }
  return { items: [...items], exclude: [...exclude] };
}

/** The transform object's pivot as the animation object's: the same side
 *  while the object holds the same items (so its box is the same), else —
 *  and with an offset — the point itself, so the pivot is exactly where it
 *  was set. */
export function animationPivotOf(o: TransformObject, sameItems: boolean): ObjectPivot {
  const { at, offset } = o.pivot;
  if (!Array.isArray(at) && !offset && sameItems) {
    return at;
  }
  const p = pivotPoint(o.pivot, transformState.get().info[o.id]?.restBox);
  return [
    Math.round(p[0] * PIVOT_ROUND) / PIVOT_ROUND,
    Math.round(p[1] * PIVOT_ROUND) / PIVOT_ROUND,
    Math.round(p[2] * PIVOT_ROUND) / PIVOT_ROUND,
  ];
}

function isScaled(o: TransformObject): boolean {
  return o.scale.some((s) => Math.abs(s - 1) >= SCALED_MIN);
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const fromTransformActions = {
  /** Add transform object `id` to the active scene. With `withSubObjects`
   *  everything riding on it comes along, each as a sub-object with its own
   *  first key; without, what rides on it is left out of the new object (it
   *  then follows whatever animation object above still holds it, or stands
   *  at rest). An object the scene already has (the same items) is reused.
   *  One undo step. Resolves the ids of the animation objects made. */
  async add(id: string, withSubObjects: boolean): Promise<string[]> {
    const all = transformState.get().objects;
    const root = all.find((o) => o.id === id);
    const scene = activeScene();
    if (!root || !scene) {
      return [];
    }
    const riders = treeOrder(all)
      .map((r) => r.object)
      .filter((o) => ridersOf(all, id).includes(o));
    const list = withSubObjects ? [root, ...riders] : [root];
    const leftBehind = withSubObjects ? [] : all.filter((o) => o.parent === id);
    const animId = new Map<string, string>();
    const made: AnimObject[] = [];
    const names = new Set<string>();
    let adopt: string[] = [];
    for (const o of list) {
      const set = o === root ? itemsOf(o, leftBehind) : { items: o.items, exclude: o.exclude ?? [] };
      const existing = objectWithItems(set.items, set.exclude);
      if (existing) {
        animId.set(o.id, existing.id);
        continue;
      }
      const place = o === root ? await placeInTree(set.items, set.exclude) : { adopt: [] };
      const parent = (o.parent ? animId.get(o.parent) : undefined) ?? place.parent;
      const name = freeName(o.name, names);
      names.add(name);
      const next: AnimObject = {
        id: newId('o'),
        name,
        items: set.items,
        ...(set.exclude.length > 0 ? { exclude: set.exclude } : {}),
        ...(parent ? { parent } : {}),
        pivot: animationPivotOf(o, o !== root || leftBehind.length === 0),
        path: 'straight',
        keys: [{ t: FIRST_KEY_S, move: [...o.move], rotate: [...o.rotate], interp: 'smooth' }],
      };
      animId.set(o.id, next.id);
      made.push(next);
      if (o === root) {
        adopt = place.adopt;
      }
    }
    if (made.length === 0) {
      toast.info('The animation scene has these objects already.');
      return [];
    }
    const rootAnim = animId.get(root.id);
    animationDocActions.commit((d) =>
      mapActiveScene(d, (s) => ({
        ...s,
        objects: [
          ...s.objects.map((x) => (rootAnim && adopt.includes(x.id) ? { ...x, parent: rootAnim } : x)),
          ...made,
        ],
      })),
    );
    toast.success(
      `${made.length} object${made.length === 1 ? '' : 's'} added to the animation scene "${scene.name || 'Scene'}", keyed at ${FIRST_KEY_S} s.`,
    );
    const scaled = list.filter(isScaled).map((o) => `"${o.name}"`);
    if (scaled.length > 0) {
      toast.warning(`Animation does not scale: the scale of ${scaled.join(', ')} was left behind.`);
    }
    return made.map((o) => o.id);
  },
};
