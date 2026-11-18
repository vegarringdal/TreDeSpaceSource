import { afterEach, describe, expect, it } from 'vitest';
import { resetColorUndo } from '../src/lib/modeldb/colorUndo';
import { HAS_COLOR_OVERRIDE, IS_HIDDEN, models } from '../src/lib/modeldb/dbState';
import { forgetTempIsolate, tempIsolateApi } from '../src/lib/modeldb/tempIsolate';
import { makeModel } from './helpers/testModel';

/** A model with `n` leaf items under one root. */
function model(n: number) {
  const entries: [string, number][] = [['root', -1]];
  const leaves: number[] = [];
  for (let i = 0; i < n; i++) {
    entries.push([`item${i}`, 0]);
    leaves.push(i + 1);
  }
  return makeModel(entries, leaves);
}

const isHidden = (m: ReturnType<typeof model>, i: number): boolean => (m.states[i * 2] & IS_HIDDEN) !== 0;
const hiddenList = (m: ReturnType<typeof model>): number[] =>
  Array.from({ length: m.itemCount }, (_, i) => i).filter((i) => isHidden(m, i));

afterEach(() => {
  forgetTempIsolate();
  resetColorUndo();
  models.length = 0;
});

describe('temporary isolate', () => {
  it('isolates the selection, then puts back exactly what it changed', () => {
    const m = model(5);
    m.states[1 * 2] |= IS_HIDDEN; // selected but hidden before
    m.states[3 * 2] |= IS_HIDDEN; // hidden before, not selected
    m.selected = Uint32Array.from([0, 1]);
    models.push(m);

    tempIsolateApi.tempIsolateStart();
    expect(tempIsolateApi.tempIsolateActive()).toBe(true);
    expect(hiddenList(m)).toEqual([2, 3, 4]);

    // while isolated: hide a part of the selection, colour another
    m.states[0 * 2] |= IS_HIDDEN;
    m.states[1 * 2] |= HAS_COLOR_OVERRIDE;
    m.states[1 * 2 + 1] = 0xff0000ff;

    tempIsolateApi.tempIsolateEnd();
    expect(tempIsolateApi.tempIsolateActive()).toBe(false);
    // 2 and 4 come back; 3 was hidden before; 1 was hidden before (shown by
    // the isolate, hidden again); 0 was hidden by the user meanwhile
    expect(hiddenList(m)).toEqual([0, 1, 3]);
    // the colour set while isolated survives
    expect(m.states[1 * 2] & HAS_COLOR_OVERRIDE).not.toBe(0);
    expect(m.states[1 * 2 + 1]).toBe(0xff0000ff);
  });

  it('hides a model with nothing selected and shows it again after', () => {
    const a = model(3);
    a.selected = Uint32Array.from([2]);
    const b = model(4);
    models.push(a, b);

    tempIsolateApi.tempIsolateStart();
    expect(hiddenList(b)).toEqual([0, 1, 2, 3]);
    tempIsolateApi.tempIsolateEnd();
    expect(hiddenList(a)).toEqual([]);
    expect(hiddenList(b)).toEqual([]);
  });

  it('forgets a model so a revived slot is never restored from stale state', () => {
    const m = model(3);
    m.selected = Uint32Array.from([0]);
    models.push(m);

    tempIsolateApi.tempIsolateStart();
    forgetTempIsolate([0]);
    expect(tempIsolateApi.tempIsolateActive()).toBe(false);
    m.states.fill(0); // the slot came back from a fresh load
    expect(tempIsolateApi.tempIsolateEnd()).toEqual([]);
    expect(hiddenList(m)).toEqual([]);
  });

  it('ending without a start changes nothing', () => {
    models.push(model(2));
    expect(tempIsolateApi.tempIsolateActive()).toBe(false);
    expect(tempIsolateApi.tempIsolateEnd()).toEqual([]);
  });
});
