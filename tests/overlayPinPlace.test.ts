import { describe, expect, it } from 'vitest';
import { PIN_PAD, pinPlace } from '../src/lib/overlay/pinPlace';

describe('pinPlace', () => {
  it('puts a pinned card in its corner, edge middle or the centre, a little in from the edge', () => {
    const near = 1 - PIN_PAD;
    expect(pinPlace('tl')).toEqual([PIN_PAD, PIN_PAD]);
    expect(pinPlace('t')).toEqual([0.5, PIN_PAD]);
    expect(pinPlace('tr')).toEqual([near, PIN_PAD]);
    expect(pinPlace('l')).toEqual([PIN_PAD, 0.5]);
    expect(pinPlace('c')).toEqual([0.5, 0.5]);
    expect(pinPlace('r')).toEqual([near, 0.5]);
    expect(pinPlace('bl')).toEqual([PIN_PAD, near]);
    expect(pinPlace('b')).toEqual([0.5, near]);
    expect(pinPlace('br')).toEqual([near, near]);
  });
});
