// The import folders are part of a Set Color search: at "All lvl" a row
// tests the folder names on every model's path like it tests entry names,
// and a folder hit takes every model under it — Append, Remove and Keep
// alike. A Multi / packed line naming a folder may carry its own colour.
import { describe, expect, it } from 'vitest';
import { parseColor } from '../src/lib/color/hexColor';
import { parseMultiColumn } from '../src/lib/color/multiColorParse';
import { packedFromLines } from '../src/lib/color/packedNames';
import { applyColorRules, type ColorRuleSpec } from '../src/lib/modeldb/colorRules';
import { type DbModel, HAS_COLOR_OVERRIDE, models } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

//  SOME_FOLDER1.RVM          (import folder = model a's group)
//    MODEL1                  (a's root entries)
//      HVAC-01 ── item 0
//      PIPE-01 ── item 1
//    MODEL2
//      HVAC-02 ── item 2
//  SOME_OTHER_FOLDER.rvm     (import folder = model b's group)
//    MODEL3
//      HVAC-03 ── item 0
const a = makeModel(
  [
    ['MODEL1', -1],
    ['MODEL2', -1],
    ['HVAC-01', 0],
    ['PIPE-01', 0],
    ['HVAC-02', 1],
  ],
  [2, 3, 4],
);
a.group = 'SOME_FOLDER1.RVM';
const b = makeModel(
  [
    ['MODEL3', -1],
    ['HVAC-03', 0],
  ],
  [1],
);
b.group = 'SOME_OTHER_FOLDER.rvm';
models.push(a, b);

const RED = parseColor('red') ?? -1;
const GREEN = parseColor('#00ff00') ?? -1;
const YELLOW = 0xff00ffff;

type Filter = ColorRuleSpec['filters'][number];
const filter = (op: Filter['op'], mode: Filter['mode'], value: string, level = 0): Filter => ({
  op,
  mode,
  value,
  level,
});
const rule = (filters: Filter[], extra: Partial<ColorRuleSpec> = {}): ColorRuleSpec => ({
  filters,
  colorRGBA8: YELLOW,
  opacityPct: null,
  ...extra,
});
const run = (filters: Filter[], extra: Partial<ColorRuleSpec> = {}): number[] =>
  applyColorRules([rule(filters, extra)], 'reset').counts;

/** The colour override of each item, null where the item has none. */
const colors = (m: DbModel): (number | null)[] =>
  Array.from({ length: m.itemCount }, (_, i) => (m.states[i * 2] & HAS_COLOR_OVERRIDE ? m.states[i * 2 + 1] : null));

describe('Set Color: import folders are part of the search', () => {
  it('All lvl: a Contains hit on the folder name takes the whole model (fast path)', () => {
    expect(run([filter('append', 'contains', 'folder1')])).toEqual([3]);
    expect(colors(a)).toEqual([YELLOW, YELLOW, YELLOW]);
    expect(colors(b)).toEqual([null]);
  });

  it('All lvl: the folder names count in the Remove fallback too', () => {
    // everything, minus the other folder
    expect(run([filter('append', 'contains', ''), filter('remove', 'contains', 'other')])).toEqual([3]);
    expect(colors(a)).toEqual([YELLOW, YELLOW, YELLOW]);
    expect(colors(b)).toEqual([null]);
    // both folders (case-insensitive), minus one root of the first
    expect(run([filter('append', 'contains', '.rvm'), filter('remove', 'single', 'MODEL2')])).toEqual([3]);
    expect(colors(a)).toEqual([YELLOW, YELLOW, null]);
    expect(colors(b)).toEqual([YELLOW]);
  });

  it('Multi / packed: a folder line carries its own colour, a deeper row wins', () => {
    const text = 'SOME_FOLDER1.RVM\tred\nMODEL2\t#00ff00';
    const { names, perName, perOpacity } = parseMultiColumn(text);
    expect(run([filter('append', 'multi', names)], { perNameColor: perName, perNameOpacity: perOpacity })).toEqual([3]);
    expect(colors(a)).toEqual([RED, RED, GREEN]);
    expect(colors(b)).toEqual([null]);
    const packed: Filter = { op: 'append', mode: 'packed', value: '', packed: packedFromLines(text), level: 0 };
    expect(run([packed])).toEqual([3]);
    expect(colors(a)).toEqual([RED, RED, GREEN]);
    // the same folder line through the Remove fallback
    const remove = filter('remove', 'single', 'nothing');
    expect(run([filter('append', 'multi', names), remove], { perNameColor: perName })).toEqual([3]);
    expect(colors(a)).toEqual([RED, RED, GREEN]);
  });

  it('a level still tests only the folder / entries at that level', () => {
    expect(run([filter('append', 'contains', 'model', 1)])).toEqual([0]);
    expect(run([filter('append', 'contains', 'model', 2)])).toEqual([4]);
    expect(run([filter('append', 'ends', '.rvm', 1)])).toEqual([4]);
    expect(run([filter('append', 'contains', 'hvac', 3)])).toEqual([3]);
  });
});

describe('Set Color: Keep intersects the rows above (in the rule) with this row', () => {
  it('a folder, then only the HVAC under it', () => {
    expect(run([filter('append', 'contains', 'folder1'), filter('keep', 'contains', 'hvac')])).toEqual([2]);
    expect(colors(a)).toEqual([YELLOW, null, YELLOW]);
    expect(colors(b)).toEqual([null]);
  });

  it('a Keep on a folder name narrows to that folder', () => {
    expect(run([filter('append', 'contains', 'hvac'), filter('keep', 'contains', 'other')])).toEqual([1]);
    expect(colors(a)).toEqual([null, null, null]);
    expect(colors(b)).toEqual([YELLOW]);
  });

  it('a blank Keep keeps everything; one matching nothing empties the set', () => {
    expect(run([filter('append', 'contains', 'folder1'), filter('keep', 'contains', '')])).toEqual([3]);
    expect(run([filter('append', 'contains', 'folder1'), filter('keep', 'contains', 'nothing-here')])).toEqual([0]);
  });

  it('a Keep at a level tests only that level', () => {
    expect(run([filter('append', 'contains', ''), filter('keep', 'contains', 'model1', 2)])).toEqual([2]);
    expect(colors(a)).toEqual([YELLOW, YELLOW, null]);
    expect(colors(b)).toEqual([null]);
  });

  it('a Keep only sees its own rule: an earlier rule is not narrowed', () => {
    const first = rule([filter('append', 'contains', 'other')], { colorRGBA8: RED });
    const second = rule([filter('append', 'contains', 'folder1'), filter('keep', 'contains', 'pipe')]);
    expect(applyColorRules([first, second], 'reset').counts).toEqual([1, 1]);
    expect(colors(a)).toEqual([null, YELLOW, null]);
    expect(colors(b)).toEqual([RED]);
  });
});
