// The Import NWD unit choice (src/lib/nwd2tdp/nwdUnits.ts): the factor each
// choice hands the converter, and the order the hotkey steps through.
import { describe, expect, it } from 'vitest';
import { NWD_UNITS, nextNwdUnits, nwdUnitScale } from '../src/lib/nwd2tdp/nwdUnits';

describe('NWD units', () => {
  it('gives the converter metres per model unit, 0 for automatic', () => {
    expect(nwdUnitScale('auto')).toBe(0);
    expect(nwdUnitScale('asis')).toBe(1);
    expect(nwdUnitScale('ft')).toBe(0.3048);
    expect(nwdUnitScale('in')).toBe(0.0254);
    expect(nwdUnitScale('mm')).toBe(0.001);
    expect(nwdUnitScale('cm')).toBe(0.01);
  });

  it('steps through every choice once and wraps', () => {
    let at = NWD_UNITS[0].value;
    const seen = [at];
    for (let i = 1; i < NWD_UNITS.length; i++) {
      at = nextNwdUnits(at);
      seen.push(at);
    }
    expect(new Set(seen).size).toBe(NWD_UNITS.length);
    expect(nextNwdUnits(at)).toBe(NWD_UNITS[0].value);
  });
});
