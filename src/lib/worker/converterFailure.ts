// What to tell the user when a wasm converter that holds the whole file in
// memory (NWD, IFC) fails. A wasm32 module can address 4 GB; past that an
// allocation aborts the module, and all the user used to see was the trap's
// own text ("unreachable"). Pure — the worker passes in what it measured —
// so it is unit-tested.

import { formatBytes } from '../opfs/storageSpace';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** `trap` = the wasm module aborted; `alloc` = JavaScript could not allocate
 *  a buffer; `other` = an error the converter reported itself. */
export type FailureKind = 'trap' | 'alloc' | 'other';

export interface ConverterFailure {
  readonly error: unknown;
  /** The converter's name as the user knows it: "Navisworks", "IFC". */
  readonly converter: string;
  readonly sourceName: string;
  readonly sourceBytes: number;
  /** Size of the wasm memory when it failed; undefined when not measured
   *  (the worker itself died). */
  readonly memoryBytes?: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** All a wasm32 module can address. */
export const WASM32_LIMIT_BYTES = 4 * 1024 ** 3;

/** A trap with at least this much memory in use is taken as out of memory: an
 *  allocation fails when the request no longer fits under the limit, which
 *  for a growing buffer happens well before the memory is full. */
const OUT_OF_MEMORY_FROM_BYTES = WASM32_LIMIT_BYTES / 2;

const TRAP_TEXT = /RuntimeError|unreachable/i;
const ALLOC_TEXT = /RangeError|out of memory|allocation failed|invalid array(?: buffer)? length/i;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function textOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Tell a module abort and a failed allocation from an error the converter
 *  reported itself. Works on the error object and on a message that crossed
 *  a worker boundary ("Uncaught RuntimeError: unreachable"). */
export function classifyFailure(error: unknown): FailureKind {
  const text = textOf(error);
  if (error instanceof RangeError || ALLOC_TEXT.test(text)) {
    return 'alloc';
  }

  if (error instanceof WebAssembly.RuntimeError || TRAP_TEXT.test(text)) {
    return 'trap';
  }

  return 'other';
}

/**
 * The message for a failed conversion, or null when the converter reported
 * the error itself and its own text should be shown. Says "too large" only
 * when the measurements support it; a trap with little memory in use is
 * reported as a crash, with the figures.
 */
export function describeConverterFailure(failure: ConverterFailure): string | null {
  const kind = classifyFailure(failure.error);
  if (kind === 'other') {
    return null;
  }

  const file = `${failure.sourceName} (${formatBytes(failure.sourceBytes)})`;
  const limit = formatBytes(WASM32_LIMIT_BYTES);
  const used = failure.memoryBytes === undefined ? null : formatBytes(failure.memoryBytes);
  const isOutOfMemory =
    kind === 'alloc' || (failure.memoryBytes !== undefined && failure.memoryBytes >= OUT_OF_MEMORY_FROM_BYTES);

  if (isOutOfMemory) {
    const figures = used ? ` (${used} of its ${limit} limit in use)` : '';

    return (
      `${file} is too large to import in the browser: the ${failure.converter} converter ran out of memory${figures}. ` +
      'It holds the whole file in memory while it works. Export the model in smaller parts and import those.'
    );
  }

  const figures = used ? `${used} of its ${limit} memory limit in use` : 'memory use unknown';

  return (
    `${file} could not be imported: the ${failure.converter} converter stopped unexpectedly (${figures}). ` +
    'A large file may have run out of memory; otherwise the file holds something the converter cannot read.'
  );
}
