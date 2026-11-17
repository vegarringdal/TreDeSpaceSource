// The Set Color panel's Select: the enabled rules as a search — it selects
// exactly the items a Run of the same rules colours, and colours nothing.
import { describe, expect, it } from 'vitest';
import { packHex } from '../src/lib/color/hexColor';
import { selectionApi } from '../src/lib/modeldb/apiSelection';
import { applyColorRules, type ColorRuleSpec } from '../src/lib/modeldb/colorRules';
import { type DbModel, HAS_COLOR_OVERRIDE, IS_SELECTED, models } from '../src/lib/modeldb/dbState';
import { makeModel } from './helpers/testModel';

//  test                (import folder = level 1)
//    SITE-A
//      PIPE-1
//        PIPE-1/B1 ── item 0
//        PIPE-1/FLANGE ── item 1
//        PIPE-1/B2 ── item 2
//      EQUI-1
//        EQUI-1/BOX ── item 3
//        EQUI-1/CYL ── item 4
//      VALVE-1 ── item 5
//    SITE-B
//      STRU-1 ── item 6
const plant = makeModel(
  [
    ['SITE-A', -1],
    ['PIPE-1', 0],
    ['PIPE-1/B1', 1],
    ['PIPE-1/FLANGE', 1],
    ['PIPE-1/B2', 1],
    ['EQUI-1', 0],
    ['EQUI-1/BOX', 5],
    ['EQUI-1/CYL', 5],
    ['VALVE-1', 0],
    ['SITE-B', -1],
    ['STRU-1', 9],
  ],
  [2, 3, 4, 6, 7, 8, 10],
);
models.push(plant);

const RED = packHex('#ff0000');
const BLUE = packHex('#0000ff');

const contains = (op: 'append' | 'remove', value: string, level = 0): ColorRuleSpec['filters'][number] => ({
  op,
  mode: 'contains',
  value,
  level,
});
const search = (filters: ColorRuleSpec['filters']): ColorRuleSpec => ({ filters, colorRGBA8: null, opacityPct: null });
const itemsWhere = (m: DbModel, bit: number): number[] =>
  Array.from({ length: m.itemCount }, (_, i) => i).filter((i) => m.states[i * 2] & bit);

describe('Set Color Select: the items a Run would colour', () => {
  it('unions every rule, honours Remove, and matches the Run', () => {
    const rules: ColorRuleSpec[] = [
      { filters: [contains('append', 'pipe-1'), contains('remove', 'flange')], colorRGBA8: RED, opacityPct: null },
      {
        filters: [{ op: 'append', mode: 'multi', value: 'valve-1', level: 0 }],
        colorRGBA8: BLUE,
        opacityPct: null,
      },
    ];
    selectionApi.selectByColorRules(rules);
    expect(itemsWhere(plant, IS_SELECTED)).toEqual([0, 2, 5]);
    expect(Array.from(plant.selected)).toEqual([0, 2, 5]);
    expect(itemsWhere(plant, HAS_COLOR_OVERRIDE)).toEqual([]); // Select colours nothing
    applyColorRules(rules, 'reset', false, { undo: false });
    expect(itemsWhere(plant, HAS_COLOR_OVERRIDE)).toEqual(itemsWhere(plant, IS_SELECTED));
  });

  it('replaces the previous selection; a level limits the names tested', () => {
    selectionApi.selectByColorRules([search([contains('append', 'site')])]);
    expect(itemsWhere(plant, IS_SELECTED)).toHaveLength(7);
    // level 1 is the import folder, the sites sit at 2
    selectionApi.selectByColorRules([search([contains('append', '1', 3)])]);
    expect(itemsWhere(plant, IS_SELECTED)).toEqual([0, 1, 2, 3, 4, 5, 6]); // PIPE-1, EQUI-1, VALVE-1, STRU-1
    selectionApi.selectByColorRules([search([contains('append', '1', 2)])]);
    expect(itemsWhere(plant, IS_SELECTED)).toEqual([]); // no site name holds a 1
    selectionApi.selectByColorRules([search([contains('append', 'b1', 4)])]);
    expect(itemsWhere(plant, IS_SELECTED)).toEqual([0]);
  });
});
