import { afterEach, describe, expect, it, vi } from 'vitest';
import { POOL_CEILING, workerPoolCap } from '../src/state/assets/workerPoolCap';

function withCores(cores: number | undefined): void {
  vi.stubGlobal('navigator', cores === undefined ? {} : { hardwareConcurrency: cores });
}

describe('workerPoolCap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves one core for the main thread', () => {
    withCores(4);
    expect(workerPoolCap()).toBe(3);
    withCores(8);
    expect(workerPoolCap()).toBe(7);
  });

  it('never drops below one worker', () => {
    withCores(2);
    expect(workerPoolCap()).toBe(1);
    withCores(1);
    expect(workerPoolCap()).toBe(1);
  });

  it('caps at the pool ceiling on many-core machines', () => {
    withCores(32);
    expect(workerPoolCap()).toBe(POOL_CEILING);
  });

  it('assumes four cores when the browser hides the count', () => {
    withCores(undefined);
    expect(workerPoolCap()).toBe(3);
  });

  it('assumes four cores when there is no navigator at all', () => {
    vi.stubGlobal('navigator', undefined);
    expect(workerPoolCap()).toBe(3);
  });
});
