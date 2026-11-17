// Every committed wasm binary must be the one built from the committed Rust
// sources. scripts/build-wasm.mjs records a fingerprint of the sources and a
// hash of the binary next to it; both are recomputed here, with no Rust
// toolchain. See scripts/wasm-units.mjs for what the fingerprint covers.

import { describe, expect, it } from 'vitest';
import { currentBuildInfo, recordedBuildInfo, WASM_UNITS } from '../scripts/wasm-units.mjs';

describe.each(WASM_UNITS.map((u) => u.unit))('wasm build record: %s', (unit) => {
  const recorded = recordedBuildInfo(unit);
  const current = currentBuildInfo(unit);

  it('has a build record', () => {
    expect(recorded, `no build-info.json — run: node scripts/build-wasm.mjs ${unit}`).not.toBeNull();
  });

  it('was built from the committed sources', () => {
    expect(
      recorded?.sources,
      `the Rust sources of ${unit} changed since its wasm was built — run: node scripts/build-wasm.mjs ${unit}`,
    ).toBe(current.sources);
  });

  it('is the binary the build recorded', () => {
    expect(
      recorded?.wasm,
      `the wasm of ${unit} is not the one its build recorded — run: node scripts/build-wasm.mjs ${unit}`,
    ).toBe(current.wasm);
  });
});
