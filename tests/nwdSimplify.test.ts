// The Import NWD simplification settings (src/lib/nwd2tdp/nwdSimplify.ts): the
// meshopt pair they hand the converter, and the hotkeys' clamped steps.
import { describe, expect, it } from 'vitest';
import {
  NWD_ERROR_MAX,
  NWD_KEEP_MAX,
  NWD_KEEP_MIN,
  nwdMeshoptOptions,
  stepNwdError,
  stepNwdKeep,
} from '../src/lib/nwd2tdp/nwdSimplify';

describe('NWD simplify', () => {
  it('turns percentages into the converter fractions', () => {
    expect(nwdMeshoptOptions({ simplify: true, simplifyKeep: 75, simplifyError: 0 })).toEqual({
      threshold: 0.75,
      targetError: 0,
    });
    expect(nwdMeshoptOptions({ simplify: true, simplifyKeep: 50, simplifyError: 1 })).toEqual({
      threshold: 0.5,
      targetError: 0.01,
    });
  });

  it('skips the pass when off, whatever the other settings say', () => {
    expect(nwdMeshoptOptions({ simplify: false, simplifyKeep: 10, simplifyError: 5 })).toEqual({
      threshold: 1,
      targetError: 0,
    });
  });

  it('steps Keep by 5 inside its range', () => {
    expect(stepNwdKeep(75, 1)).toBe(80);
    expect(stepNwdKeep(75, -1)).toBe(70);
    expect(stepNwdKeep(NWD_KEEP_MAX, 1)).toBe(NWD_KEEP_MAX);
    expect(stepNwdKeep(NWD_KEEP_MIN, -1)).toBe(NWD_KEEP_MIN);
  });

  it('steps Max error by 0.1 without drifting, inside its range', () => {
    let error = 0;
    for (let i = 0; i < 3; i++) {
      error = stepNwdError(error, 1);
    }
    expect(error).toBe(0.3);
    expect(stepNwdError(0, -1)).toBe(0);
    expect(stepNwdError(NWD_ERROR_MAX, 1)).toBe(NWD_ERROR_MAX);
  });
});
