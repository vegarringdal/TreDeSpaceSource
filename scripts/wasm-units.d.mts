// Types for wasm-units.mjs so the type-checked tests can import it.
export interface WasmUnit {
  unit: string;
  crate: string;
  features: string[];
  manifestStem: string | null;
}
export interface BuildInfo {
  /** Hash of everything the binary is built from. */
  sources: string;
  /** SHA-256 of the committed `_bg.wasm`. */
  wasm: string;
  /** The workspace crates that go into it. */
  crates: string[];
}
export const REPO_ROOT: string;
export const BUILD_INFO_FILE: string;
export const WASM_UNITS: WasmUnit[];
export function unitDir(unit: string): string;
export function wasmPath(unit: string): string;
export function sourceFingerprint(unit: string): Pick<BuildInfo, 'sources' | 'crates'>;
export function currentBuildInfo(unit: string): BuildInfo;
export function recordedBuildInfo(unit: string): BuildInfo | null;
