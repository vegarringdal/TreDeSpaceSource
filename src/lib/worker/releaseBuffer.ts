// Give an ArrayBuffer's memory back NOW instead of at some later garbage
// collection — for a worker that has copied a whole source file into wasm
// memory and would otherwise hold it twice for the rest of the conversion.

interface ResizableByTransfer {
  transfer(newByteLength?: number): ArrayBuffer;
}

function canTransfer(buffer: ArrayBuffer): buffer is ArrayBuffer & ResizableByTransfer {
  return 'transfer' in buffer && typeof buffer.transfer === 'function';
}

/**
 * Detach `buffer` and free its memory (`ArrayBuffer.prototype.transfer`,
 * ES2024). Every view of it becomes empty, so call it only after the last
 * read. Where the method is missing the buffer is left for the collector.
 */
export function releaseBuffer(buffer: ArrayBuffer): void {
  if (canTransfer(buffer) && buffer.byteLength > 0) {
    buffer.transfer(0);
  }
}
