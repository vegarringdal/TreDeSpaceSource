// The overlay layer's scene adapter: instance lookup (doc instances, the
// virtual step cards), design / theme resolution (the user's library first,
// then the copy embedded in the file), binding context and object anchor
// points.

import { STEP_CARD_PREFIX } from '../../lib/animation/evaluate';
import { lastStepAt, type SceneView, stepNumber } from '../../lib/animation/scene';
import type { AnimationDoc, AnimObject, Step, V3 } from '../../lib/animation/types';
import type { OverlayScene, ResolvedOverlay } from '../../lib/overlay/AnimOverlay';
import type {
  BindingContext,
  OverlayComponent,
  OverlayFrame,
  OverlayInstance,
  OverlayTheme,
  Pin,
} from '../../lib/overlay/overlayTypes';
import { appAutoTheme, libraryComponent, libraryTheme } from '../overlayComponents/overlayComponents.actions';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface OverlaySceneDeps {
  doc(): AnimationDoc;
  view(): SceneView | null;
  time(): number;
  viewProj(): Float32Array;
  objectPoint(object: string): V3 | null;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Where a step card sits by default (bottom-left, above the cube). */
const STEP_CARD_PIN: Pin = 'bl';
const EDGE = 0.02;

/** Screen position of each pin (0..1 of the view). */
const PIN_POS: Readonly<Record<Pin, [number, number]>> = {
  tl: [EDGE, EDGE],
  t: [0.5, EDGE],
  tr: [1 - EDGE, EDGE],
  l: [EDGE, 0.5],
  c: [0.5, 0.5],
  r: [1 - EDGE, 0.5],
  bl: [EDGE, 1 - 2 * EDGE],
  b: [0.5, 1 - 2 * EDGE],
  br: [1 - EDGE, 1 - 2 * EDGE],
};

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** An id → element lookup per (immutable) doc array — per-frame lookups for
 *  every shown card stay O(1) in a big scene. */
function idCache<T extends { id: string }>(): (list: readonly T[]) => Map<string, T> {
  const cache = new WeakMap<readonly T[], Map<string, T>>();
  return (list) => {
    let map = cache.get(list);
    if (!map) {
      map = new Map(list.map((x) => [x.id, x]));
      cache.set(list, map);
    }
    return map;
  };
}

const instancesById = idCache<OverlayInstance>();
const stepsById = idCache<Step>();
const objectsById = idCache<AnimObject>();

/** Library copy first (the user may have restyled it), else the embedded one. */
export function findComponent(doc: AnimationDoc, id: string): OverlayComponent | null {
  return libraryComponent(id) ?? doc.overlayComponents.find((c) => c.id === id) ?? null;
}

/** A theme by id; no id (Auto) is the app's light / dark theme. */
export function findTheme(doc: AnimationDoc, id: string | null | undefined): OverlayTheme | null {
  if (!id) {
    return appAutoTheme();
  }
  return libraryTheme(id) ?? doc.overlayThemes.find((t) => t.id === id) ?? null;
}

/** The overlay a step card is drawn as: its own card, else the scene's. */
function stepCardInstance(doc: AnimationDoc, view: SceneView | null, id: string): OverlayInstance | null {
  const step = view ? stepsById(view.scene.steps).get(id.slice(STEP_CARD_PREFIX.length)) : undefined;
  if (!view || !step || step.card === null) {
    return null;
  }
  const own = step.card;
  const component = own?.component ?? view.scene.stepCard?.component;
  if (!component) {
    return null;
  }
  const pin = own?.place ?? STEP_CARD_PIN;
  return {
    id,
    component,
    componentVersion: findComponent(doc, component)?.version ?? 1,
    values: own?.values ?? {},
    theme: own ? (own.theme ?? null) : (view.scene.stepCard?.theme ?? null),
    anchor: { kind: 'screen', pos: PIN_POS[pin], pin },
    scale: 1,
    ...(own?.textScale !== undefined ? { textScale: own.textScale } : {}),
  };
}

/** An instance of the doc, or the virtual card of a step. */
export function findInstance(doc: AnimationDoc, view: SceneView | null, id: string): OverlayInstance | null {
  if (id.startsWith(STEP_CARD_PREFIX)) {
    return stepCardInstance(doc, view, id);
  }
  return instancesById(doc.overlayInstances).get(id) ?? null;
}

/** {{step.*}}, {{object.name}}, {{time}}, {{duration}} for one overlay: a
 *  step card names its own step, the others the step at T (the last one
 *  started, so a gap still names it). */
export function bindingContext(
  view: SceneView | null,
  T: number,
  step: string | null,
  instance: OverlayInstance | null,
): BindingContext {
  const s = view ? ((step ? stepsById(view.scene.steps).get(step) : null) ?? lastStepAt(view, T)) : null;
  const anchorObject = instance?.anchor.kind === 'object' ? instance.anchor.object : null;
  return {
    step: s && view ? { name: s.name, text: s.text, index: stepNumber(view, s.id), count: view.steps.length } : null,
    objectName: anchorObject && view ? (objectsById(view.scene.objects).get(anchorObject)?.name ?? null) : null,
    time: T,
    duration: view?.duration ?? 0,
  };
}

// -----------------------------------------------------------------------------
// scene
// -----------------------------------------------------------------------------

/** The OverlayScene the viewport layer draws through. */
export function makeOverlayScene(deps: OverlaySceneDeps): OverlayScene {
  return {
    viewProj: deps.viewProj,
    objectPoint: deps.objectPoint,
    keepOnScreen: () => deps.view()?.scene.keepOverlaysOnScreen !== false,
    resolve(instanceId: string): ResolvedOverlay | null {
      const doc = deps.doc();
      const instance = findInstance(doc, deps.view(), instanceId);
      const component = instance ? findComponent(doc, instance.component) : null;
      if (!instance || !component) {
        return null;
      }
      return { instance, component, theme: findTheme(doc, instance.theme) };
    },
    bindings(frame: OverlayFrame, instance: OverlayInstance): BindingContext {
      return bindingContext(deps.view(), deps.time(), frame.step, instance);
    },
  };
}
