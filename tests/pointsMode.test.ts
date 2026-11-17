import { describe, expect, it } from 'vitest';
import { arePointsShown, hiddenKeepMs, isShownMode } from '../src/state/scans/pointsMode';

describe('arePointsShown', () => {
  it('off and hidden never show, always does', () => {
    expect(arePointsShown('off', null)).toBe(false);
    expect(arePointsShown('off', 'scan:0')).toBe(false);
    expect(arePointsShown('hidden', 'scan:0')).toBe(false);
    expect(arePointsShown('always', null)).toBe(true);
    expect(arePointsShown('always', 'scan:0')).toBe(true);
  });

  it('entered shows only while a setup is entered', () => {
    expect(arePointsShown('entered', null)).toBe(false);
    expect(arePointsShown('entered', 'scan:0')).toBe(true);
  });
});

describe('isShownMode', () => {
  it('tells the modes that draw points in some view', () => {
    expect((['off', 'hidden', 'always', 'entered'] as const).map(isShownMode)).toEqual([false, false, true, true]);
  });
});

describe('hiddenKeepMs', () => {
  it('unloads at once when off, never while hidden, after the grace otherwise', () => {
    expect(hiddenKeepMs('off', 5000)).toBe(0);
    expect(hiddenKeepMs('hidden', 5000)).toBe(Number.POSITIVE_INFINITY);
    expect(hiddenKeepMs('entered', 5000)).toBe(5000);
  });
});
