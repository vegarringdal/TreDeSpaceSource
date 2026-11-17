import { describe, expect, it } from 'vitest';
import { HAS_COLOR_OVERRIDE, HAS_OPACITY_OVERRIDE, IS_HIDDEN, OPACITY_SHIFT } from '../src/lib/modeldb/dbState';
import { applyActorLayer, blendLookWords, lerpRGBA8 } from '../src/lib/modeldb/lookBlend';

const RED = 0xff0000ff;
const BLUE = 0xffff0000;
const MESH = 0xff808080;
const ghost = (pct: number) => (HAS_OPACITY_OVERRIDE | (pct << OPACITY_SHIFT)) >>> 0;
const pctOf = (flags: number) => (flags & IS_HIDDEN ? 0 : flags & HAS_OPACITY_OVERRIDE ? flags >>> OPACITY_SHIFT : 100);

describe('blendLookWords', () => {
  it('returns the exact end words at mix 0 and 1', () => {
    expect(blendLookWords(IS_HIDDEN, 0, HAS_COLOR_OVERRIDE, RED, MESH, 0)).toEqual([IS_HIDDEN, 0]);
    expect(blendLookWords(IS_HIDDEN, 0, HAS_COLOR_OVERRIDE, RED, MESH, 1)).toEqual([HAS_COLOR_OVERRIDE, RED]);
  });

  it('fades a hidden item in through opacity', () => {
    const [f] = blendLookWords(IS_HIDDEN, 0, 0, 0, MESH, 0.5);
    expect(pctOf(f)).toBe(50);
    expect(f & IS_HIDDEN).toBe(0);
  });

  it('fades a ghost to full and blends from the mesh colour into an override', () => {
    const [f, c] = blendLookWords(ghost(20), 0, HAS_COLOR_OVERRIDE, RED, MESH, 0.5);
    expect(pctOf(f)).toBe(60);
    expect(f & HAS_COLOR_OVERRIDE).toBeTruthy();
    expect(c).toBe(lerpRGBA8(MESH, RED, 0.5));
  });

  it('stays override-free when neither look colours the item', () => {
    const [f] = blendLookWords(0, 0, ghost(40), 0, MESH, 0.5);
    expect(f & HAS_COLOR_OVERRIDE).toBe(0);
  });
});

describe('applyActorLayer', () => {
  const none = { visible: null, opacity: null, color: null };

  it('keeps the look words when the actor has no keys', () => {
    expect(applyActorLayer(ghost(15), 0, MESH, none)).toEqual([ghost(15), 0]);
  });

  it('a colour key overrides, and fading back to null blends to the look colour', () => {
    expect(applyActorLayer(0, 0, MESH, { ...none, color: { from: null, to: BLUE, mix: 1 } })).toEqual([
      HAS_COLOR_OVERRIDE,
      BLUE,
    ]);
    const [f, c] = applyActorLayer(HAS_COLOR_OVERRIDE, RED, MESH, { ...none, color: { from: BLUE, to: null, mix: 0.5 } });
    expect(f & HAS_COLOR_OVERRIDE).toBeTruthy();
    expect(c).toBe(lerpRGBA8(BLUE, RED, 0.5));
    expect(applyActorLayer(0, 0, MESH, { ...none, color: { from: BLUE, to: null, mix: 1 } })).toEqual([0, 0]);
  });

  it('visibility beats the look, opacity is clamped to 1 %', () => {
    expect(applyActorLayer(IS_HIDDEN, 0, MESH, { ...none, visible: true })[0] & IS_HIDDEN).toBe(0);
    expect(pctOf(applyActorLayer(0, 0, MESH, { ...none, opacity: 0.001 })[0])).toBe(1);
  });
});
