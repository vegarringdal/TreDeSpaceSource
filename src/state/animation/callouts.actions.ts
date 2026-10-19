// Callouts (DESIGN.md › Animation › Overlays): an overlay instance shown on
// the Callouts row from `start` to `end`, hanging from an object or pinned
// to the screen, with position keys over its time. A viewport drag keys the
// place at the time slider once the callout has keys (or Auto-key is on);
// otherwise it moves the anchor itself. Every edit goes through commit.

import { toast } from '@treDeSpaceUI/widgets';
import { STEP_CARD_PREFIX } from '../../lib/animation/evaluate';
import { newId } from '../../lib/animation/io';
import { upsertKey } from '../../lib/animation/keyRows';
import { sampleOverlayPlace } from '../../lib/animation/overlayKeys';
import type { AnimationDoc, Callout, CalloutKey, V2 } from '../../lib/animation/types';
import {
  PRESET_CALLOUT,
  PRESET_CAPTION,
  PRESET_INFO_IMAGE,
  PRESET_STEP_CARD,
  PRESET_TITLE,
} from '../../lib/overlay/overlayPresets';
import type { OverlayAnchor, OverlayFx, OverlayInstance, OverlayValue } from '../../lib/overlay/overlayTypes';
import { libraryComponent } from '../overlayComponents/overlayComponents.actions';
import { animationDocActions } from './animationDoc.actions';
import { animationDocState } from './animationDoc.state';
import { animationUiState } from './animationUi.state';
import { activeScene, mapActiveScene } from './docEdit';
import { objectsActions } from './objects.actions';
import { liveTimeNow } from './runtime';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** How long a new callout shows (s). */
export const NEW_CALLOUT_S = 3;
const FADE: OverlayFx = { kind: 'fade', duration: 0.3 };
/** Where an attached label sits from its object (px). */
const LABEL_OFFSET: V2 = [80, -70];

/** Where each preset sits on screen when added (others: centred). */
const SCREEN_PLACES: Readonly<Record<string, OverlayAnchor>> = {
  [PRESET_TITLE.id]: { kind: 'screen', pos: [0.5, 0.4], pin: 'c' },
  [PRESET_CAPTION.id]: { kind: 'screen', pos: [0.5, 0.94], pin: 'b' },
  [PRESET_INFO_IMAGE.id]: { kind: 'screen', pos: [0.98, 0.04], pin: 'tr' },
  [PRESET_STEP_CARD.id]: { kind: 'screen', pos: [0.02, 0.96], pin: 'bl' },
  default: { kind: 'screen', pos: [0.5, 0.5], pin: 'c' },
};

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function doc(): AnimationDoc {
  return animationDocState.get().doc;
}

/** Where a new overlay of this design sits on screen. */
export function overlayScreenPlace(component: string): OverlayAnchor {
  return SCREEN_PLACES[component] ?? SCREEN_PLACES.default;
}

/** The anchor's own placement: pos for screen anchors, offset otherwise. */
function anchorPlace(a: OverlayAnchor): V2 {
  return a.kind === 'screen' ? [a.pos[0], a.pos[1]] : [a.offset[0], a.offset[1]];
}

function mapInstance(d: AnimationDoc, id: string, fn: (i: OverlayInstance) => OverlayInstance): AnimationDoc {
  if (!d.overlayInstances.some((i) => i.id === id)) {
    return d;
  }
  return { ...d, overlayInstances: d.overlayInstances.map((i) => (i.id === id ? fn(i) : i)) };
}

function mapCallout(id: string, fn: (c: Callout) => Callout, coalesce?: string): void {
  animationDocActions.commit(
    (d) => mapActiveScene(d, (s) => ({ ...s, callouts: s.callouts.map((c) => (c.id === id ? fn(c) : c)) })),
    coalesce,
  );
}

function editKeys(id: string, fn: (keys: readonly CalloutKey[]) => CalloutKey[], coalesce?: string): void {
  mapCallout(
    id,
    (c) => {
      const keys = fn(c.keys ?? []).sort((a, b) => a.t - b.t);
      const { keys: _old, ...rest } = c;
      return keys.length ? { ...rest, keys } : rest;
    },
    coalesce,
  );
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const calloutsActions = {
  /** A new overlay of a design with a callout from `start` for
   *  NEW_CALLOUT_S, picked. */
  add(opts: {
    component: string;
    anchor: OverlayAnchor;
    start: number;
    values?: Record<string, OverlayValue>;
  }): string {
    const instance = newId('ov');
    const callout: Callout = {
      id: newId('c'),
      instance,
      start: opts.start,
      end: opts.start + NEW_CALLOUT_S,
      enter: FADE,
      exit: FADE,
    };
    const inst: OverlayInstance = {
      id: instance,
      component: opts.component,
      componentVersion: libraryComponent(opts.component)?.version ?? 1,
      values: opts.values ?? {},
      theme: null,
      anchor: opts.anchor,
      scale: 1,
    };
    animationDocActions.commit((d) =>
      mapActiveScene({ ...d, overlayInstances: [...d.overlayInstances, inst] }, (s) => ({
        ...s,
        callouts: [...s.callouts, callout],
      })),
    );
    animationUiState.set({ picked: { kind: 'callout', id: callout.id, keys: [] }, current: '@callouts' });
    return callout.id;
  },

  /** + Callout: a label hanging from the selection's object (made when the
   *  selection is not one yet), from the time slider. */
  async addForSelection(): Promise<void> {
    const ids = await objectsActions.forSelection();
    const object = ids[0];
    if (!object) {
      toast.info('Select the item the callout is for first.');
      return;
    }
    const name = activeScene()?.objects.find((o) => o.id === object)?.name ?? 'Item';
    calloutsActions.add({
      component: PRESET_CALLOUT.id,
      anchor: { kind: 'object', object, offset: LABEL_OFFSET, leader: true },
      start: liveTimeNow(),
      values: { title: name },
    });
  },

  /** Any design as an overlay: a callout design hangs from the selection,
   *  the others sit at their place on screen. */
  async addDesign(component: string): Promise<void> {
    if (component === PRESET_CALLOUT.id) {
      await calloutsActions.addForSelection();
      return;
    }
    calloutsActions.add({ component, anchor: overlayScreenPlace(component), start: liveTimeNow() });
  },

  updateInstance(id: string, patch: Partial<Omit<OverlayInstance, 'id'>>, coalesce?: string): void {
    animationDocActions.commit((d) => mapInstance(d, id, (i) => ({ ...i, ...patch })), coalesce);
  },

  setValue(id: string, param: string, value: OverlayValue): void {
    animationDocActions.commit((d) =>
      mapInstance(d, id, (i) => (i.values[param] === value ? i : { ...i, values: { ...i.values, [param]: value } })),
    );
  },

  update(id: string, patch: Partial<Omit<Callout, 'id' | 'instance'>>, coalesce?: string): void {
    mapCallout(id, (c) => ({ ...c, ...patch }), coalesce);
  },

  /** Its show / hide times (start before end, never before 0). */
  setSpan(id: string, start: number, end: number, coalesce?: string): void {
    const a = Math.max(0, Math.min(start, end));
    mapCallout(id, (c) => ({ ...c, start: a, end: Math.max(a, end) }), coalesce);
  },

  /** Move it by dt (its keys come along). */
  move(id: string, dt: number, coalesce?: string): void {
    mapCallout(
      id,
      (c) => {
        const d = Math.max(-c.start, dt);
        return { ...c, start: c.start + d, end: c.end + d };
      },
      coalesce,
    );
  },

  /** Remove a callout and its overlay. */
  remove(id: string): void {
    const c = activeScene()?.callouts.find((x) => x.id === id);
    if (!c) {
      return;
    }
    animationDocActions.commit((d) => {
      const used = d.scenes.some((s) => s.callouts.some((x) => x.id !== id && x.instance === c.instance));
      const withoutCallout = mapActiveScene(d, (s) => ({ ...s, callouts: s.callouts.filter((x) => x.id !== id) }));
      return used
        ? withoutCallout
        : { ...withoutCallout, overlayInstances: withoutCallout.overlayInstances.filter((i) => i.id !== c.instance) };
    });
    const p = animationUiState.get().picked;
    if (p.kind === 'callout' && p.id === id) {
      animationUiState.set({ picked: { kind: 'none' } });
    }
  },

  /** A one-off copy of its design: a style edit then no longer applies to
   *  the other overlays using it. */
  detach(instance: string, newComponent: string): void {
    animationDocActions.commit((d) => mapInstance(d, instance, (i) => ({ ...i, component: newComponent })));
  },

  /** The callout of the active scene showing an instance. */
  ofInstance(instance: string): Callout | null {
    return activeScene()?.callouts.find((c) => c.instance === instance) ?? null;
  },

  /** A viewport drag: a key at the time slider when the callout is keyed
   *  (or Auto-key is on), else the anchor for its whole time. Step cards
   *  keep their place (set in the Key panel). */
  moveOverlay(instance: string, anchor: OverlayAnchor): void {
    if (instance.startsWith(STEP_CARD_PREFIX)) {
      return;
    }
    const c = calloutsActions.ofInstance(instance);
    const keyed = (c?.keys?.length ?? 0) > 0 || animationUiState.get().autoKey;
    if (!c || !keyed) {
      calloutsActions.updateInstance(instance, { anchor }, `overlay-move:${instance}`);
      return;
    }
    const t = Math.max(0, liveTimeNow() - c.start);
    const own = c.keys?.find((k) => Math.abs(k.t - t) < 1e-3);
    editKeys(
      c.id,
      (keys) => upsertKey(keys, { t, at: anchorPlace(anchor), interp: own?.interp ?? 'smooth' }),
      `overlay-key:${c.id}:${t.toFixed(3)}`,
    );
  },

  /** A position key at the time slider holding where the callout is now. */
  keyHere(id: string): void {
    const c = activeScene()?.callouts.find((x) => x.id === id);
    const inst = c ? doc().overlayInstances.find((i) => i.id === c.instance) : undefined;
    if (!c || !inst) {
      return;
    }
    const t = Math.max(0, liveTimeNow() - c.start);
    const at = sampleOverlayPlace(c.keys, t) ?? anchorPlace(inst.anchor);
    editKeys(id, (keys) => upsertKey(keys, { t, at, interp: 'smooth' }));
  },

  deleteKeys(id: string, indices: readonly number[]): void {
    editKeys(id, (keys) => keys.filter((_, i) => !indices.includes(i)));
  },

  clearKeys(id: string): void {
    editKeys(id, () => []);
  },

  /** Retime position keys by dt (never before the callout's start). */
  moveKeys(id: string, indices: readonly number[], dt: number, coalesce?: string): void {
    editKeys(
      id,
      (keys) => keys.map((k, i) => (indices.includes(i) ? { ...k, t: Math.max(0, k.t + dt) } : k)),
      coalesce,
    );
  },
};
