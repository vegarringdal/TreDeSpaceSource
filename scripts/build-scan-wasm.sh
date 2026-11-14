#!/usr/bin/env sh
# Rebuild the laser-scan (scan2tdpp: LGSX / E57 → .tdpp) and Navisworks
# (nwd2tdp: NWD / NWC → .tdp) wasm modules into src/lib/<unit>/wasm/.
# Needs the Rust toolchain (rust_src/rust-toolchain.toml), wasm-pack and a
# wasm-capable clang + llvm-ar for the bundled C++ meshoptimizer — plain
# distro clang works (Fedora: sudo dnf install clang llvm).
set -eu
cd "$(dirname "$0")/../rust_src"

build() { # <crate> <unit dir under src/lib> <stem>
  CC="${CC:-clang}" AR="${AR:-llvm-ar}" \
    wasm-pack build "crates/$1" --target web --release --out-dir "../../../src/lib/$2/wasm"
  out="../src/lib/$2/wasm"
  rm -f "$out/.gitignore"
  # copied manifests: the third-party notices' fallback source
  cp "crates/$3-core/Cargo.toml" "$out/$3-core.Cargo.toml"
  cp "crates/$1/Cargo.toml" "$out/$1.Cargo.toml"
}

build scan-wasm scan2tdpp scan
build nwd-wasm nwd2tdp nwd
echo "done — now: npm run gen:notices && npx vitest run tests/wasmSmoke.test.ts"
