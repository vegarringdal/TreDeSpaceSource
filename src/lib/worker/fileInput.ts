// A picked File as a wasm converter's input: synchronous range reads straight
// from disk, so the file is never staged in OPFS or held whole in memory.
// Worker-only — FileReaderSync does not exist on the main thread.

/** Worker-only reader, missing from TS's lib.dom. */
declare const FileReaderSync: { new (): { readAsArrayBuffer(blob: Blob): ArrayBuffer } };

/** What a converter's `io` object needs to read its input. */
export interface FileInput {
  size(): number;
  read(offset: number, len: number): Uint8Array;
}

/** The input side of a converter's `io` over `file`. A read past the end
 *  returns the bytes there are. */
export function fileInputIo(file: File): FileInput {
  const reader = new FileReaderSync();

  return {
    size: () => file.size,
    read: (offset, len) => new Uint8Array(reader.readAsArrayBuffer(file.slice(offset, offset + len))),
  };
}
