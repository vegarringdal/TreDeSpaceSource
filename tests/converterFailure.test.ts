import { describe, expect, it } from 'vitest';
import { classifyFailure, describeConverterFailure } from '../src/lib/worker/converterFailure';
import { releaseBuffer } from '../src/lib/worker/releaseBuffer';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const source = { converter: 'Navisworks', sourceName: 'plant.nwd', sourceBytes: 350 * MB };

describe('classifyFailure', () => {
  it('knows a wasm trap, also after it crossed a worker boundary', () => {
    expect(classifyFailure(new WebAssembly.RuntimeError('unreachable'))).toBe('trap');
    expect(classifyFailure(new Error('Uncaught RuntimeError: unreachable'))).toBe('trap');
  });

  it('knows a failed allocation', () => {
    expect(classifyFailure(new RangeError('Array buffer allocation failed'))).toBe('alloc');
    expect(classifyFailure('Uncaught RangeError: Invalid array buffer length')).toBe('alloc');
  });

  it('leaves the converter’s own errors alone', () => {
    expect(classifyFailure('not a Navisworks file')).toBe('other');
    expect(classifyFailure(new Error('io.read returned 0 bytes'))).toBe('other');
  });
});

describe('describeConverterFailure', () => {
  it('says too large when the trap came with the memory nearly full', () => {
    const msg = describeConverterFailure({
      ...source,
      error: new WebAssembly.RuntimeError('unreachable'),
      memoryBytes: 3.6 * GB,
    });
    expect(msg).toContain('plant.nwd (350 MB) is too large to import in the browser');
    expect(msg).toContain('3.6 GB of its 4.0 GB limit in use');
  });

  it('says too large for a failed allocation', () => {
    const msg = describeConverterFailure({ ...source, error: new RangeError('Array buffer allocation failed') });
    expect(msg).toContain('is too large to import in the browser');
  });

  it('does not blame the size when little memory was in use', () => {
    const msg = describeConverterFailure({
      ...source,
      error: new WebAssembly.RuntimeError('unreachable'),
      memoryBytes: 200 * MB,
    });
    expect(msg).toContain('stopped unexpectedly (200 MB of its 4.0 GB memory limit in use)');
    expect(msg).not.toContain('too large');
  });

  it('reports a crash without figures when the worker died', () => {
    const msg = describeConverterFailure({ ...source, error: new Error('Uncaught RuntimeError: unreachable') });
    expect(msg).toContain('stopped unexpectedly (memory use unknown)');
  });

  it('returns null for an error the converter reported itself', () => {
    expect(describeConverterFailure({ ...source, error: 'not a Navisworks file', memoryBytes: GB })).toBeNull();
  });
});

describe('releaseBuffer', () => {
  it('frees the buffer and empties its views', () => {
    const buffer = new ArrayBuffer(1024);
    const view = new Uint8Array(buffer);
    releaseBuffer(buffer);
    expect(buffer.byteLength).toBe(0);
    expect(view.byteLength).toBe(0);
  });
});
