import { describe, expect, it } from 'vitest';
import { DEFAULT_VRAM_BUDGET_MB, migrateVramBudget, vramBudgetMb } from '../src/state/viewer/vramBudget';

describe('vramBudgetMb', () => {
  it('is the ceiling while enabled and 0 while off', () => {
    expect(vramBudgetMb({ vramBudgetOn: true, maxVramMb: 2048 })).toBe(2048);
    expect(vramBudgetMb({ vramBudgetOn: false, maxVramMb: 2048 })).toBe(0);
  });
});

describe('migrateVramBudget', () => {
  it('turns a saved budget into enabled + the same ceiling', () => {
    expect(migrateVramBudget({ maxVramMb: 512, fpsLimit: 30 })).toEqual({ maxVramMb: 512, fpsLimit: 30, vramBudgetOn: true });
  });

  it('turns a saved 0 into off + the default ceiling', () => {
    expect(migrateVramBudget({ maxVramMb: 0 })).toEqual({ maxVramMb: DEFAULT_VRAM_BUDGET_MB, vramBudgetOn: false });
  });

  it('moves the old default speed (normal) to fast, keeps a chosen relaxed', () => {
    expect(migrateVramBudget({ maxVramMb: 0, vramSwapSpeed: 'normal' }).vramSwapSpeed).toBe('fast');
    expect(migrateVramBudget({ maxVramMb: 0, vramSwapSpeed: 'relaxed' }).vramSwapSpeed).toBe('relaxed');
  });

  it('leaves blobs that already carry the switch, or no budget, alone', () => {
    const done = { maxVramMb: 0, vramBudgetOn: true };
    expect(migrateVramBudget(done)).toBe(done);
    const none = { fpsLimit: 30 };
    expect(migrateVramBudget(none)).toBe(none);
  });
});
