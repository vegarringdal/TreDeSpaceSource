import { afterEach, describe, expect, it } from 'vitest';
import { forgetModelTables, models } from '../src/lib/modeldb/dbState';
import {
  dropModelFromGlobalIndex,
  ensureGlobalIndex,
  firstLiveHit,
  hitModel,
  indexRevivedModel,
  liveHits,
  resetGlobalIndex,
} from '../src/lib/modeldb/globalNameIndex';
import { makeModel } from './helpers/testModel';

const modelOf = (packed: number | undefined): number => (packed === undefined ? -1 : hitModel(packed));

describe('forgetModelTables', () => {
  it('releases every table but keeps identity, itemCount and the tombstone', () => {
    const m = makeModel(
      [
        ['root', -1],
        ['a', 0],
        ['b', 0],
      ],
      [1, 2],
    );
    m.removed = true;

    forgetModelTables(m);

    expect(m.forgotten).toBe(true);
    expect(m.removed).toBe(true);
    expect(m.name).toBe('test');
    expect(m.itemCount).toBe(2);
    expect(m.hierarchy.entryParent.length).toBe(0);
    expect(m.childStart.length).toBe(0);
    expect(m.itemToEntry.length).toBe(0);
    expect(m.states.length).toBe(0);
    expect(m.tidx.length).toBe(0);
    expect(m.baseColor.length).toBe(0);
    expect(m.itemBounds.length).toBe(0);
    expect(m.selected.length).toBe(0);
    expect(m.itemsUnder).toBeUndefined();
    expect(m.namesLower).toBeNull();
  });
});

describe('global name index across unload and revive', () => {
  afterEach(() => {
    models.length = 0;
    resetGlobalIndex();
  });

  it('drops a forgotten model and re-inserts it in model order on revive', () => {
    const a = makeModel(
      [
        ['root', -1],
        ['pipe', 0],
      ],
      [1],
    );
    const b = makeModel(
      [
        ['root', -1],
        ['pipe', 0],
      ],
      [1],
    );
    models.push(a, b);
    ensureGlobalIndex();
    expect(modelOf(firstLiveHit('pipe'))).toBe(0);

    a.removed = true;
    forgetModelTables(a);
    dropModelFromGlobalIndex(0);
    expect(modelOf(firstLiveHit('pipe'))).toBe(1);
    const afterDrop: number[] = [];
    liveHits('root', (p) => afterDrop.push(hitModel(p)));
    expect(afterDrop).toEqual([1]);

    // revive: reviveModel puts a fresh record in the slot and re-indexes it
    models[0] = makeModel(
      [
        ['root', -1],
        ['pipe', 0],
      ],
      [1],
    );
    indexRevivedModel(0);
    expect(modelOf(firstLiveHit('pipe'))).toBe(0);
    const afterRevive: number[] = [];
    liveHits('pipe', (p) => afterRevive.push(hitModel(p)));
    expect(afterRevive).toEqual([0, 1]);
  });

  it('leaves a slot the incremental build has not reached to ensureGlobalIndex', () => {
    models.push(
      makeModel(
        [
          ['root', -1],
          ['x', 0],
        ],
        [1],
      ),
    );
    indexRevivedModel(0);
    expect(firstLiveHit('x')).toBeUndefined();
    ensureGlobalIndex();
    expect(modelOf(firstLiveHit('x'))).toBe(0);
  });
});
