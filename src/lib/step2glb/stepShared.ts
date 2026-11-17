// Shared plumbing for the STEP import workers (coordinator + tessellation
// sub-workers): the options, the progress shape, and the OPFS sync-handle
// helpers over temp/step-import/ — the staged input, one cache file per
// sub-worker, the coordinator's spill file, and the cooked outputs.

/** UI-facing conversion options. */
export interface StepOptions {
  /** Chordal sag tolerance (mm) — smaller = smoother curves, more triangles. */
  deflectionMm: number;
  /** Max chord turn angle (deg) — smaller = smoother curves, more triangles. */
  maxAngleDeg: number;
  /** Weld positions (drops normals) — matches the app's flatshaded rendering. */
  cleanup: boolean;
  /** Tessellation sub-workers (0 = tessellate in the coordinator). Each one
   *  holds its own copy of the file index, so more = faster but more memory. */
  workers: number;
}

/** Pipeline stage of a progress tick (the wasm's `Phase` codes). */
export type StepPhase = 'index' | 'faces' | 'products' | 'cook' | 'write';

const PHASES: readonly StepPhase[] = ['index', 'faces', 'products', 'cook', 'write'];

/** Wire code → phase name; unknown codes read as 'faces' (the long one). */
export function phaseFromCode(code: number): StepPhase {
  return PHASES[code] ?? 'faces';
}

export const PHASE_FACES_CODE = 1;

export interface StepProgress {
  phase: StepPhase;
  done: number;
  total: number;
  /** Tessellation sub-workers in use (0 = in-process). */
  workers: number;
  /** Sub-workers currently on a batch — fewer than `workers` near the end,
   *  or for a long time when one giant product is left. */
  busy: number;
}

/** Worker-only synchronous OPFS handle (missing from TS's lib.dom). */
export interface SyncHandle {
  getSize(): number;
  read(b: Uint8Array, opts: { at: number }): number;
  truncate(n: number): void;
  write(b: Uint8Array, opts: { at: number }): number;
  flush(): void;
  close(): void;
}

export const STEP_INPUT_NAME = 'input.step';
export const SPILL_NAME = 'spill.bin';
/** The coordinator's index, streamed out once and read by every sub-worker. */
export const INDEX_NAME = 'index.bin';
export const cacheName = (slot: number): string => `cache-${slot}.bin`;

/** temp/step-import — the worker-side twin of `opfs.ts`'s `stepTempDir`. */
export async function stepTempDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const temp = await root.getDirectoryHandle('temp', { create: true });
  return temp.getDirectoryHandle('step-import', { create: true });
}

interface SyncOpenOptions {
  create?: boolean;
  /** Shared read-only mode (Chrome 121+): several workers may hold one. */
  readOnly?: boolean;
}

interface SyncCapableHandle {
  createSyncAccessHandle(opts?: { mode: 'read-only' }): Promise<SyncHandle>;
}

export async function openSync(
  dir: FileSystemDirectoryHandle,
  name: string,
  opts: SyncOpenOptions = {},
): Promise<SyncHandle> {
  const fh = await dir.getFileHandle(name, { create: opts.create ?? false });
  // worker-only API, missing from TS's lib.dom
  const capable = fh as unknown as SyncCapableHandle;
  return opts.readOnly ? capable.createSyncAccessHandle({ mode: 'read-only' }) : capable.createSyncAccessHandle();
}

/** Read `len` bytes at `offset` into a fresh array (shorter at EOF). */
export function readRange(h: SyncHandle, offset: number, len: number): Uint8Array {
  const buf = new Uint8Array(len);
  const n = h.read(buf, { at: offset });
  return n === len ? buf : buf.subarray(0, n);
}

/** A sync handle used append-style: tracks its own length so the wasm's
 *  `tempLen` calls never hit `getSize()`, and truncates on open. */
export class ScratchFile {
  private readonly h: SyncHandle;
  private len = 0;

  constructor(h: SyncHandle) {
    this.h = h;
    h.truncate(0);
  }

  get length(): number {
    return this.len;
  }

  writeAt(offset: number, bytes: Uint8Array): void {
    this.h.write(bytes, { at: offset });
    this.len = Math.max(this.len, offset + bytes.length);
  }

  readAt(offset: number, len: number): Uint8Array {
    return readRange(this.h, offset, len);
  }

  close(): void {
    this.h.flush();
    this.h.close();
  }
}

/** Refuse a role this worker does not play (the wasm never calls these here). */
export function notHere(role: string): never {
  throw new Error(`step worker: ${role} is not available on this worker`);
}
