// -----------------------------------------------------------------------------
// look / actor-colour blending (DESIGN.md › Animation, D25, D26)
// -----------------------------------------------------------------------------
// Pure state-word maths for animation looks: blend two looks' result words
// for one item, and lay an actor's own keys (colour, opacity, visibility) on
// top of the look. Only the LOOK_BITS band and the colour word are produced;
// the caller keeps every other bit (selection, edges) of the live word.

import { COLOR_UNDO_BITS } from './colorUndo';
import { HAS_COLOR_OVERRIDE, HAS_OPACITY_OVERRIDE, IS_HIDDEN, OPACITY_MASK, OPACITY_SHIFT } from './dbState';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** An actor colour key in force: RGBA8 or null (= the look's colour). */
export interface ActorColorLayer {
  from: number | null;
  to: number | null;
  mix: number;
}

/** What an actor's own keys say right now; null = no key (keep the look). */
export interface ActorLayer {
  visible: boolean | null;
  /** 0..1 */
  opacity: number | null;
  color: ActorColorLayer | null;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** The bits a look owns — the same band as Set Color and colour undo. */
export const LOOK_BITS = COLOR_UNDO_BITS;

const OPACITY_BITS = HAS_OPACITY_OVERRIDE | OPACITY_MASK;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Effective visibility of a word as a percentage (hidden = 0). */
function visiblePct(flags: number): number {
  if (flags & IS_HIDDEN) {
    return 0;
  }
  return flags & HAS_OPACITY_OVERRIDE ? (flags & OPACITY_MASK) >>> OPACITY_SHIFT : 100;
}

/** Per-channel blend of two packed RGBA8 colours. */
export function lerpRGBA8(a: number, b: number, t: number): number {
  if (t <= 0) {
    return a >>> 0;
  }
  if (t >= 1) {
    return b >>> 0;
  }
  let out = 0;
  for (let sh = 0; sh < 32; sh += 8) {
    const ca = (a >>> sh) & 0xff;
    const cb = (b >>> sh) & 0xff;
    out |= Math.round(ca + (cb - ca) * t) << sh;
  }
  return out >>> 0;
}

/** LOOK_BITS flags showing `pct` (0..100): hidden at 0, an override below 100. */
function flagsForPct(pct: number): number {
  const v = Math.round(pct);
  if (v <= 0) {
    return IS_HIDDEN;
  }
  return v >= 100 ? 0 : (HAS_OPACITY_OVERRIDE | (v << OPACITY_SHIFT)) >>> 0;
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Blend two look results for one item. `a*`/`b*` are LOOK_BITS flags and
 *  colour words (a clean scene is 0/0), `mesh` the item's own colour. At the
 *  ends the exact words are returned, so a finished fade leaves no trace. */
export function blendLookWords(
  aFlags: number,
  aColor: number,
  bFlags: number,
  bColor: number,
  mesh: number,
  mix: number,
): [number, number] {
  if (mix >= 1) {
    return [bFlags & LOOK_BITS, bColor];
  }
  if (mix <= 0) {
    return [aFlags & LOOK_BITS, aColor];
  }
  const pct = visiblePct(aFlags) + (visiblePct(bFlags) - visiblePct(aFlags)) * mix;
  const aHas = (aFlags & HAS_COLOR_OVERRIDE) !== 0;
  const bHas = (bFlags & HAS_COLOR_OVERRIDE) !== 0;
  let flags = flagsForPct(pct);
  let color = 0;
  if (aHas || bHas) {
    flags |= HAS_COLOR_OVERRIDE;
    color = lerpRGBA8(aHas ? aColor : mesh, bHas ? bColor : mesh, mix);
  }
  return [flags >>> 0, color];
}

/** An actor's own keys over its look-layer words (`base*`): colour first,
 *  then opacity, then visibility. An opacity key is clamped to 1 % — hiding
 *  is the visibility key's job. */
export function applyActorLayer(
  baseFlags: number,
  baseColor: number,
  mesh: number,
  layer: ActorLayer,
): [number, number] {
  let flags = baseFlags & LOOK_BITS;
  let color = baseColor;
  if (layer.color) {
    const lookColor = flags & HAS_COLOR_OVERRIDE ? baseColor : mesh;
    const from = layer.color.from ?? lookColor;
    const to = layer.color.to ?? lookColor;
    const mixed = lerpRGBA8(from, to, layer.color.mix);
    const isDefault = layer.color.to === null && (layer.color.mix >= 1 || layer.color.from === null);
    if (!isDefault) {
      flags |= HAS_COLOR_OVERRIDE;
      color = mixed;
    }
  }
  if (layer.opacity !== null && layer.opacity < 1) {
    const v = Math.max(1, Math.round(layer.opacity * 100));
    flags = ((flags & ~OPACITY_BITS) | HAS_OPACITY_OVERRIDE | (v << OPACITY_SHIFT)) >>> 0;
  }
  if (layer.visible !== null) {
    flags = layer.visible ? flags & ~IS_HIDDEN : flags | IS_HIDDEN;
  }
  return [flags >>> 0, color >>> 0];
}
