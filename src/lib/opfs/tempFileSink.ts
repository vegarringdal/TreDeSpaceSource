// The converter worker's side of tempFileWriter.ts: hand the bytes of each
// output to the writer sub-worker as the wasm core emits them, so nothing is
// kept in this worker's memory and the files reach disk while the conversion
// is still running. Worker-only (it spawns a worker).

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface TempFileSink {
  /** Append `bytes` to `name` at offset `at`. The bytes are copied before
   *  this returns — wasm reuses its memory after the call. */
  write(name: string, at: number, bytes: Uint8Array): void;
  /** `name` is complete at `size` bytes. */
  end(name: string, size: number): void;
  /** Resolves once every queued write has landed; throws if one failed. */
  flush(): Promise<void>;
  /** Stop the writer (after `flush`, or to give up). */
  terminate(): void;
}

interface FlushReply {
  flushed: number;
  errors: string[];
}

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/**
 * Open a sink that writes into `temp/<dir>/` in OPFS.
 *
 * postMessage queues even from a thread blocked in wasm, so each chunk leaves
 * as it arrives: a file is never held whole on this side and never
 * concatenated — the writer appends it at the offset given. The chunk is
 * copied once, straight into the buffer that is transferred.
 */
export function openTempFileSink(dir: string): TempFileSink {
  const writer = new Worker(new URL('./tempFileWriter.ts', import.meta.url), { type: 'module' });
  writer.postMessage({ dir });

  return {
    write(name, at, bytes) {
      const copy = new Uint8Array(bytes);
      writer.postMessage({ name, at, bytes: copy.buffer }, [copy.buffer]);
    },

    end(name, size) {
      writer.postMessage({ name, end: size });
    },

    async flush() {
      const done = new Promise<FlushReply>((resolve) => {
        writer.onmessage = (e: MessageEvent<FlushReply>) => resolve(e.data);
      });
      writer.postMessage({ flush: true });
      const { errors } = await done;
      if (errors.length > 0) {
        throw new Error(`failed writing ${errors.length} file(s): ${errors[0]}`);
      }
    },

    terminate() {
      writer.terminate();
    },
  };
}
