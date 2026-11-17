import { describe, expect, it } from 'vitest';
import { stepField } from '../src/treDeSpaceUI/widgets/number/numberStep';
import { uniqueParamKey } from '../src/treDeSpaceUI/widgets/style/paramKey';
import { clockCommit, formatClock, parseClock } from '../src/treDeSpaceUI/widgets/time/clock';

const keep = (v: number) => v;

describe('number field steps', () => {
  it('steps the value when nothing is being typed', () => {
    expect(stepField(null, 5, 1, keep, 0)).toEqual({ value: 6, text: null });
  });

  it('steps from the typed number and carries the text along, so blur keeps the step', () => {
    // "5" typed over a value of 7: ↑ gives 6 and the field reads "6" — the old
    // "5" left in place would be committed again on blur, undoing the step
    expect(stepField('5', 7, 1, keep, 0)).toEqual({ value: 6, text: '6' });
    expect(stepField('1,5', 0, 0.5, keep, 1)).toEqual({ value: 2, text: '2.0' });
  });

  it('steps from the value when the text is not a number, and clamps', () => {
    expect(stepField('abc', 5, -1, keep, 0)).toEqual({ value: 4, text: '4' });
    expect(stepField('9', 9, 5, (v) => Math.min(10, v), 0)).toEqual({ value: 10, text: '10' });
  });
});

describe('clock field', () => {
  it('parses m:ss.s and plain seconds', () => {
    expect(parseClock('1:15.5')).toBe(75.5);
    expect(parseClock('75')).toBe(75);
    expect(parseClock('1:x')).toBeNull();
    expect(formatClock(75.5)).toBe('1:15.5');
  });

  it('commits nothing for the text it already shows, so focus passing through keeps the exact value', () => {
    expect(clockCommit(formatClock(12.53), 12.53)).toBeNull();
    expect(clockCommit(' 0:12.5 ', 12.53)).toBeNull();
  });

  it('commits typed text, and nothing for text it cannot parse', () => {
    expect(clockCommit('0:13', 12.53)).toBe(13);
    expect(clockCommit('soon', 12.53)).toBeNull();
  });
});

describe('parameter keys', () => {
  it('sanitises the key, the numbered one after a clash too', () => {
    expect(uniqueParamKey('a b', [])).toBe('a_b');
    expect(uniqueParamKey('a b', ['a_b'])).toBe('a_b2');
    expect(uniqueParamKey('x', ['x', 'x2'])).toBe('x3');
    expect(uniqueParamKey('', [])).toBe('param');
  });
});
