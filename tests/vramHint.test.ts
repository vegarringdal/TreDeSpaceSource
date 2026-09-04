// The suggested VRAM budget only speaks where it can be roughly right:
// unified-memory and mobile GPUs. Discrete cards get no suggestion — WebGPU
// cannot see their VRAM and a wrong number would only cost detail.
import { describe, expect, it } from 'vitest';
import { type AdapterHints, suggestVramBudgetMb } from '../src/lib/render/vramHint';

function hints(over: Partial<AdapterHints> = {}): AdapterHints {
  return { vendor: 'intel', architecture: 'gen-12lp', maxBufferSize: 2 ** 31, deviceMemoryGb: 8, isMobile: false, ...over };
}

describe('suggestVramBudgetMb', () => {
  it('is silent without hints or for a discrete card', () => {
    expect(suggestVramBudgetMb(null)).toBeNull();
    expect(suggestVramBudgetMb(hints({ vendor: 'nvidia', architecture: 'ampere' }))).toBeNull();
    expect(suggestVramBudgetMb(hints({ vendor: 'amd', architecture: 'rdna-3' }))).toBeNull();
  });

  it('gives an integrated desktop part a quarter of system RAM, clamped to 1–4 GB', () => {
    expect(suggestVramBudgetMb(hints({ deviceMemoryGb: 8 }))).toBe(2048);
    expect(suggestVramBudgetMb(hints({ deviceMemoryGb: 2 }))).toBe(1024);
    expect(suggestVramBudgetMb(hints({ deviceMemoryGb: 32 }))).toBe(4096);
    expect(suggestVramBudgetMb(hints({ vendor: 'apple', architecture: 'metal-3', deviceMemoryGb: 16 }))).toBe(4096);
    expect(suggestVramBudgetMb(hints({ vendor: 'amd', architecture: 'vega' }))).toBe(2048);
  });

  it('falls back to the 1 GB floor when system RAM is unknown', () => {
    expect(suggestVramBudgetMb(hints({ deviceMemoryGb: 0 }))).toBe(1024);
  });

  it('caps mobile at 1 GB whatever the vendor', () => {
    expect(suggestVramBudgetMb(hints({ vendor: 'qualcomm', isMobile: true, deviceMemoryGb: 8 }))).toBe(1024);
    expect(suggestVramBudgetMb(hints({ vendor: 'apple', isMobile: true, deviceMemoryGb: 2 }))).toBe(512);
    expect(suggestVramBudgetMb(hints({ vendor: 'nvidia', isMobile: true, deviceMemoryGb: 0 }))).toBe(1024);
  });
});
