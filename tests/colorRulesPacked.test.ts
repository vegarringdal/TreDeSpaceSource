// A packed filter must paint EXACTLY what the equivalent Multi paste paints
// (same names, per-row colors and opacities, deepest level wins).
import { describe, expect, it } from 'vitest';
import { parseMultiColumn } from '../src/lib/color/multiColorParse';
import { packedFromLines } from '../src/lib/color/packedNames';
import { applyColorRules, type ColorRuleSpec } from '../src/lib/modeldb/colorRules';
import { models } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

describe('packed color filter parity', () => {
  //        /A
  //      /   \
  //    /A/B  /A/C
  //    / \      \
  //  b1  b2     c1      (leaves = items 0..2)
  const m = makeModel(
    [
      ['/A', -1],
      ['/A/B', 0],
      ['/A/C', 0],
      ['b1', 1],
      ['b2', 1],
      ['c1', 2],
    ],
    [3, 4, 5],
  );
  models.push(m);

  const text = '/A\tred\n/A/B #00ff00:50\nb2\tdefault\n/A/C';
  const multiSpec = (): ColorRuleSpec => {
    const { names, perName, perOpacity } = parseMultiColumn(text);
    return {
      filters: [{ op: 'append', mode: 'multi', value: names, level: 0 }],
      colorRGBA8: 0xffff00ff,
      opacityPct: null,
      perNameColor: perName,
      perNameOpacity: perOpacity,
    };
  };
  const packedSpec = (): ColorRuleSpec => ({
    filters: [{ op: 'append', mode: 'packed', value: '', packed: packedFromLines(text), level: 0 }],
    colorRGBA8: 0xffff00ff,
    opacityPct: null,
  });

  it('paints the same states as the Multi paste (fast path)', () => {
    const a = applyColorRules([multiSpec()], 'reset');
    const statesA = m.states.slice();
    const b = applyColorRules([packedSpec()], 'reset');
    expect(a.counts).toEqual(b.counts);
    expect(Array.from(m.states)).toEqual(Array.from(statesA));
    // sanity: b1 green@50 (deepest /A/B), b2 default color, c1 yellow (rule
    // color under /A/C which has no per-row color... but /A is red above it)
    expect(m.states[0 * 2 + 1]).toBe(0xff00ff00);
    expect(a.counts[0]).toBe(3);
  });

  it('paints the same states with a remove filter (fallback path)', () => {
    const remove = { op: 'remove' as const, mode: 'single' as const, value: 'b1', level: 0 };
    const a = applyColorRules([{ ...multiSpec(), filters: [...multiSpec().filters, remove] }], 'reset');
    const statesA = m.states.slice();
    const b = applyColorRules([{ ...packedSpec(), filters: [...packedSpec().filters, remove] }], 'reset');
    expect(a.counts).toEqual(b.counts);
    expect(Array.from(m.states)).toEqual(Array.from(statesA));
  });
});
