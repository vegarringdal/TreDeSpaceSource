// Rebuild the Rust → wasm modules into src/lib/<unit>/wasm/ and record what
// each binary was built from (see wasm-units.mjs).
//
//   node scripts/build-wasm.mjs              all six
//   node scripts/build-wasm.mjs nwd2tdp      only the named units
//
// Needs the Rust toolchain (rust_src/rust-toolchain.toml — rustup installs it
// on first use), wasm-pack and a wasm-capable clang + llvm-ar for the bundled
// C++ meshoptimizer; plain distro clang works (Fedora: sudo dnf install clang
// llvm). Set CC / AR to use others.
//
// One recipe for every module, so a binary never depends on who typed the
// command. The builder's own paths (~/.cargo, the checkout) are mapped to
// fixed names: they would otherwise be embedded in the binary's panic
// messages — the home directory included — and make two machines' builds
// differ for no reason.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILD_INFO_FILE, currentBuildInfo, REPO_ROOT, unitDir, WASM_UNITS } from './wasm-units.mjs';

const RUST_ROOT = join(REPO_ROOT, 'rust_src');
/** wasm-pack output that is not ours to overwrite in the unit folder. */
const NOT_COPIED = /^(\.gitignore|README\.md|LICENSE.*)$/i;

/** rustc flags that replace this machine's paths in the binary. When several
 *  match, the last one wins — so the home directory goes first. */
function pathRemaps() {
  const home = homedir();
  const remaps = [
    [home, '~'],
    [process.env.RUSTUP_HOME ?? join(home, '.rustup'), '/rustup'],
    [process.env.CARGO_HOME ?? join(home, '.cargo'), '/cargo'],
    [RUST_ROOT, 'rust_src'],
  ];

  return remaps.map(([from, to]) => `--remap-path-prefix=${from}=${to}`).join(' ');
}

function build(def) {
  console.log(`\n=== ${def.unit} (${def.crate})`);
  const out = mkdtempSync(join(tmpdir(), `wasm-${def.unit}-`));
  try {
    const args = ['build', `crates/${def.crate}`, '--target', 'web', '--release', '--out-dir', out];
    if (def.features.length > 0) {
      args.push('--features', def.features.join(','));
    }
    const run = spawnSync('wasm-pack', args, {
      cwd: RUST_ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        CC: process.env.CC ?? 'clang',
        AR: process.env.AR ?? 'llvm-ar',
        RUSTFLAGS: [process.env.RUSTFLAGS, pathRemaps()].filter(Boolean).join(' '),
      },
    });
    if (run.status !== 0) {
      throw new Error(`wasm-pack failed for ${def.crate}${run.error ? `: ${run.error.message}` : ''}`);
    }

    const dir = unitDir(def.unit);
    for (const name of readdirSync(out)) {
      if (!NOT_COPIED.test(name)) {
        copyFileSync(join(out, name), join(dir, name));
      }
    }
    // copied manifests: the third-party notices' fallback source
    if (def.manifestStem) {
      for (const crate of [`${def.manifestStem}-core`, def.crate]) {
        copyFileSync(join(RUST_ROOT, 'crates', crate, 'Cargo.toml'), join(dir, `${crate}.Cargo.toml`));
      }
    }
    writeFileSync(join(dir, BUILD_INFO_FILE), `${JSON.stringify(currentBuildInfo(def.unit), null, 2)}\n`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !WASM_UNITS.some((u) => u.unit === name));
if (unknown.length > 0) {
  console.error(`unknown unit(s): ${unknown.join(', ')} — known: ${WASM_UNITS.map((u) => u.unit).join(', ')}`);
  process.exit(2);
}

for (const def of WASM_UNITS.filter((u) => wanted.length === 0 || wanted.includes(u.unit))) {
  build(def);
}
console.log(
  '\ndone — now: npx vitest run tests/wasmSmoke.test.ts tests/wasmSources.test.ts' +
    ' (and npm run gen:notices if a dependency changed)',
);
