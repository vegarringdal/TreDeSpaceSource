// The scan-offset step (src/state/scans/offsetStep.ts): range and the
// odometer-like stepping of the step box and its hotkeys.
import { describe, expect, it } from 'vitest';
import { clampOffsetStep, nextOffsetStep, offsetStepIncrement } from '../src/state/scans/offsetStep';

describe('scan offset step', () => {
  it('stays within a millimetre and a kilometre', () => {
    expect(clampOffsetStep(0)).toBe(0.001);
    expect(clampOffsetStep(-5)).toBe(0.001);
    expect(clampOffsetStep(0.0004)).toBe(0.001);
    expect(clampOffsetStep(0.2504)).toBe(0.25);
    expect(clampOffsetStep(5000)).toBe(1000);
  });

  it('steps up a tenth of its magnitude at a time', () => {
    expect(nextOffsetStep(0.1, 1)).toBe(0.2);
    expect(nextOffsetStep(0.9, 1)).toBe(1);
    expect(nextOffsetStep(1, 1)).toBe(2);
    expect(nextOffsetStep(0.25, 1)).toBe(0.35);
    expect(nextOffsetStep(1000, 1)).toBe(1000);
  });

  it('steps down into the decade below from a power of ten', () => {
    expect(nextOffsetStep(0.2, -1)).toBe(0.1);
    expect(nextOffsetStep(0.1, -1)).toBe(0.09);
    expect(nextOffsetStep(1, -1)).toBe(0.9);
    expect(nextOffsetStep(0.01, -1)).toBe(0.009);
    expect(nextOffsetStep(0.001, -1)).toBe(0.001);
  });

  it('gives the step box the increment its + uses', () => {
    expect(offsetStepIncrement(0.1)).toBeCloseTo(0.1, 9);
    expect(offsetStepIncrement(0.25)).toBeCloseTo(0.1, 9);
    expect(offsetStepIncrement(30)).toBe(10);
  });
});
