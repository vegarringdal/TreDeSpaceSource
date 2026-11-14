// Shared by the scan cook's coordinator worker and its sub-workers.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** UI-facing cook options (the rest keep the wasm defaults). */
export interface ScanCookOptions {
  /** Largest panorama mip level kept, px; 0 = no panoramas. */
  readonly panoMaxSize: number;
  /** Keep all 16 intensity bits (off: 8 bits, about a byte per point less). */
  readonly intensity16: boolean;
  /** Sub-workers the cook fans out to (0 = everything in the one worker). */
  readonly workers: number;
}

/** The cook's JSON report. */
export interface ScanCookReport {
  readonly points: number;
  readonly nodes: number;
  readonly fileSize: number;
  readonly setups: number;
}

/** Worker-only reader, missing from TS's lib.dom. */
declare const FileReaderSync: { new (): { readAsArrayBuffer(blob: Blob): ArrayBuffer } };

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** The wasm's input side over a picked File: synchronous range reads straight
 *  from disk (worker only), so a multi-GB scan is never staged or held whole. */
export function inputIo(file: File) {
  const reader = new FileReaderSync();
  return {
    size: () => file.size,
    read: (offset: number, len: number): Uint8Array =>
      new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + len))),
  };
}
