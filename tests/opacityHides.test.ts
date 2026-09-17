// Opacity 0 means HIDDEN wherever an opacity can be set: the hide flag goes
// on and the item's existing opacity override is left exactly as it was, so
// unhiding restores it (withOpacityOverride).
import { describe, expect, it } from 'vitest';
import { colorApi } from '../src/lib/modeldb/apiColor';
import { applyColorRules, type ColorRuleSpec } from '../src/lib/modeldb/colorRules';
import {
  HAS_OPACITY_OVERRIDE,
  IS_HIDDEN,
  models,
  OPACITY_MASK,
  OPACITY_SHIFT,
  opacityHides,
  withOpacityOverride,
} from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

const band = (flags: number): number => (flags & OPACITY_MASK) >>> OPACITY_SHIFT;
const AT_50 = (HAS_OPACITY_OVERRIDE | (50 << OPACITY_SHIFT)) >>> 0;

//      /A
//     /   \
//   a1     a2       (leaves = items 0..1)
const m = makeModel(
  [
    ['/A', -1],
    ['a1', 0],
    ['a2', 0],
  ],
  [1, 2],
);
models.push(m);

const rule = (opacityPct: number | null): ColorRuleSpec => ({
  filters: [{ op: 'append', mode: 'contains', value: 'a', level: 0 }],
  colorRGBA8: 0xffff00ff,
  opacityPct,
});

/** The same rule down the fallback path — a `remove` filter takes the
 *  item-level walk instead of the indexed fast path. */
const ruleSlow = (opacityPct: number | null): ColorRuleSpec => ({
  ...rule(opacityPct),
  filters: [...rule(opacityPct).filters, { op: 'remove', mode: 'single', value: 'nothing-matches', level: 0 }],
});

describe('withOpacityOverride', () => {
  it('sets the hide flag for 0 and leaves the opacity band untouched', () => {
    const out = withOpacityOverride(AT_50, 0);
    expect(out & IS_HIDDEN).toBeTruthy();
    expect(band(out)).toBe(50); // unhiding brings back the 50 % it already had
  });

  it('writes the band above 0 and leaves the hide flag alone', () => {
    expect(band(withOpacityOverride(0, 25))).toBe(25);
    expect(withOpacityOverride(0, 25) & IS_HIDDEN).toBe(0);
    expect(withOpacityOverride(IS_HIDDEN, 25) & IS_HIDDEN).toBeTruthy();
  });

  it('rounds before deciding, so a fraction landing on 0 hides', () => {
    expect(opacityHides(0.4)).toBe(true);
    expect(opacityHides(0.6)).toBe(false);
    expect(withOpacityOverride(0, 0.4) & IS_HIDDEN).toBeTruthy();
    expect(band(withOpacityOverride(0, 0.6))).toBe(1);
  });
});

describe('Set Opacity on the selection', () => {
  it('hides at 0, keeping the override the item already carried', () => {
    m.states.fill(0);
    m.states[0] = AT_50;
    m.selected = Uint32Array.from([0]);
    colorApi.setOpacityOnSelection(0);
    expect(m.states[0] & IS_HIDDEN).toBeTruthy();
    expect(band(m.states[0])).toBe(50);
  });

  it('still writes a normal override above 0', () => {
    m.states.fill(0);
    m.selected = Uint32Array.from([0]);
    colorApi.setOpacityOnSelection(30);
    expect(m.states[0] & IS_HIDDEN).toBe(0);
    expect(band(m.states[0])).toBe(30);
  });
});

describe('a colour rule asking for opacity 0', () => {
  for (const [path, spec] of [
    ['fast path', rule],
    ['fallback path', ruleSlow],
  ] as const) {
    it(`hides its matches rather than writing 0 (${path})`, () => {
      m.states.fill(0);
      m.states[0] = AT_50;
      applyColorRules([spec(0)], 'reset');
      expect(m.states[0] & IS_HIDDEN).toBeTruthy();
      expect(m.states[2] & IS_HIDDEN).toBeTruthy();
      // 'reset' clears the band first, so nothing is left to preserve here —
      // what matters is that no 0 % override was written in its place
      expect(m.states[0] & HAS_OPACITY_OVERRIDE).toBe(0);
    });

    it(`outranks hide mode's blanket unhide (${path})`, () => {
      m.states.fill(0);
      applyColorRules([spec(0)], 'hide');
      expect(m.states[0] & IS_HIDDEN).toBeTruthy();
      expect(m.states[2] & IS_HIDDEN).toBeTruthy();
    });
  }

  it('leaves hide mode unhiding its matches at any other opacity', () => {
    m.states.fill(0);
    applyColorRules([rule(100)], 'hide');
    expect(m.states[0] & IS_HIDDEN).toBe(0);
    expect(band(m.states[0])).toBe(100);
  });
});

// A run replaces the previous one, so moving a rule off 0 has to bring its
// items back — otherwise they would stay hidden with no way to reach them
// from the editor that hid them.
describe('a rule moved off opacity 0', () => {
  for (const [path, spec] of [
    ['fast path', rule],
    ['fallback path', ruleSlow],
  ] as const) {
    it(`unhides what an earlier run hid (${path})`, () => {
      m.states.fill(0);
      applyColorRules([spec(0)], 'reset');
      expect(m.states[0] & IS_HIDDEN).toBeTruthy();

      applyColorRules([spec(50)], 'reset');
      expect(m.states[0] & IS_HIDDEN).toBe(0);
      expect(band(m.states[0])).toBe(50);
    });

    // the Set editor sends a fully opaque rule as opacityPct null, NOT 100 —
    // so "put it back to opaque" arrives with no opacity at all
    it(`unhides for a rule carrying no opacity at all (${path})`, () => {
      m.states.fill(0);
      applyColorRules([spec(0)], 'reset');
      expect(m.states[0] & IS_HIDDEN).toBeTruthy();

      applyColorRules([spec(null)], 'reset');
      expect(m.states[0] & IS_HIDDEN).toBe(0);
      expect(m.states[0] & HAS_OPACITY_OVERRIDE).toBe(0);
    });
  }

  // sql.color's white / transparent base coats are a rule over EVERYTHING at
  // a non-zero opacity, so they now clear hides as well — a run with a base
  // coat owns the visible state, `default-hidden` included (it hides first).
  it('brings hidden items back through a full-model base coat', () => {
    m.states.fill(0);
    m.states[0] = IS_HIDDEN;
    m.states[2] = IS_HIDDEN;
    const whiteBase: ColorRuleSpec = {
      filters: [{ op: 'append', mode: 'contains', value: '', level: 0 }],
      colorRGBA8: 0xffffffff,
      opacityPct: null, // a fully opaque rule carries no opacity
    };
    applyColorRules([whiteBase], 'reset');
    expect(m.states[0] & IS_HIDDEN).toBe(0);
    expect(m.states[2] & IS_HIDDEN).toBe(0);
  });

  it('leaves an item no rule matches hidden', () => {
    m.states.fill(0);
    m.states[2] = IS_HIDDEN; // a2, hidden by hand
    applyColorRules(
      [{ filters: [{ op: 'append', mode: 'contains', value: 'a1', level: 0 }], colorRGBA8: 0xffff00ff, opacityPct: 50 }],
      'reset',
    );
    expect(m.states[0] & IS_HIDDEN).toBe(0);
    expect(m.states[2] & IS_HIDDEN).toBeTruthy();
  });
});
