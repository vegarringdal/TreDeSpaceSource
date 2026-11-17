// The six Rust → wasm modules the app ships (src/lib/<unit>/wasm/) and the
// fingerprint that ties each committed binary to the sources it was built
// from. A rebuild on another machine does not give the same bytes (the
// bundled C++ is compiled by the local clang), so "rebuild in CI and diff"
// cannot prove anything. Instead scripts/build-wasm.mjs records, next to each
// binary, a hash of everything that goes into it and a hash of the binary;
// tests/wasmSources.test.ts recomputes both. A source fix that was never
// rebuilt, or a binary built from a tree that was not committed, fails there.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUST_ROOT = join(REPO_ROOT, 'rust_src');
const CRATES_DIR = join(RUST_ROOT, 'crates');

/** What build-wasm.mjs writes next to each binary. */
export const BUILD_INFO_FILE = 'build-info.json';

/**
 * Every wasm module: its folder under src/lib, the crate wasm-pack builds,
 * the cargo features it is built with, and (where the third-party notices
 * read them) the stem of the crate manifests copied next to the binary.
 */
export const WASM_UNITS = [
  { unit: 'cooker', crate: 'cooker-wasm', features: [], manifestStem: null },
  { unit: 'rvm2glb', crate: 'rvm-wasm', features: ['optimize'], manifestStem: 'rvm' },
  { unit: 'ifc2glb', crate: 'ifc-wasm', features: [], manifestStem: 'ifc' },
  { unit: 'step2glb', crate: 'step-wasm', features: [], manifestStem: 'step' },
  { unit: 'scan2tdpp', crate: 'scan-wasm', features: [], manifestStem: 'scan' },
  // `optimize` compiles nwd-core's meshopt simplify pass in (the import option
  // "Simplify"); without it the option is silently a no-op
  { unit: 'nwd2tdp', crate: 'nwd-wasm', features: ['optimize'], manifestStem: 'nwd' },
];

/** Crate folders that never reach the binary. */
const SKIPPED_DIRS = new Set(['tests', 'docs', 'examples', 'benches', 'target', '.git', '.github']);
/** Prose and licence texts: changing them does not change the build. */
const SKIPPED_FILES = /(\.md|^LICENSE[^/]*)$/i;
/** Files outside the crates that decide what is built and how. */
const SHARED_INPUTS = ['rust_src/Cargo.toml', 'rust_src/rust-toolchain.toml', 'scripts/build-wasm.mjs'];

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** The folder a unit's binary lives in. */
export function unitDir(unit) {
  return join(REPO_ROOT, 'src', 'lib', unit, 'wasm');
}

/** The unit's `<crate>_bg.wasm`. */
export function wasmPath(unit) {
  const def = WASM_UNITS.find((u) => u.unit === unit);
  if (!def) {
    throw new Error(`unknown wasm unit ${unit}`);
  }

  return join(unitDir(unit), `${def.crate.replace(/-/g, '_')}_bg.wasm`);
}

/** Cargo.lock as a map: package name → its entries (one per version). */
function readLock() {
  const text = readFileSync(join(RUST_ROOT, 'Cargo.lock'), 'utf8');
  const packages = new Map();
  for (const block of text.split('[[package]]').slice(1)) {
    const field = (name) => new RegExp(`^${name} = "([^"]*)"`, 'm').exec(block)?.[1] ?? '';
    const deps = /^dependencies = \[([^\]]*)\]/m.exec(block)?.[1] ?? '';
    const entry = {
      name: field('name'),
      version: field('version'),
      source: field('source'),
      checksum: field('checksum'),
      // a dependency is "name", "name version" or "name version (source)"
      dependencies: [...deps.matchAll(/"([^"\s]+)[^"]*"/g)].map((m) => m[1]),
    };
    packages.set(entry.name, [...(packages.get(entry.name) ?? []), entry]);
  }

  return packages;
}

/**
 * Every package the crate can pull in, by name, from Cargo.lock. Wider than
 * the wasm build really uses (the lock also lists dev- and other-target
 * dependencies) — a fingerprint may ask for one rebuild too many, never one
 * too few.
 */
function lockClosure(crate, packages) {
  const seen = new Set();
  const todo = [crate];
  while (todo.length > 0) {
    const name = todo.pop();
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    for (const entry of packages.get(name) ?? []) {
      todo.push(...entry.dependencies);
    }
  }

  return [...seen].sort();
}

function listFiles(dir, into = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        listFiles(path, into);
      }
    } else if (entry.isFile() && !SKIPPED_FILES.test(entry.name)) {
      into.push(path);
    }
  }

  return into;
}

/**
 * The fingerprint of everything a unit's binary is built from: the files of
 * every workspace crate it depends on (tests, docs, examples and prose
 * left out), the exact version and checksum of every registry or git
 * dependency, the workspace manifest, the pinned toolchain, the build script
 * and the unit's own features. Paths are hashed relative to the repo, so the
 * value is the same on every machine.
 */
export function sourceFingerprint(unit) {
  const def = WASM_UNITS.find((u) => u.unit === unit);
  if (!def) {
    throw new Error(`unknown wasm unit ${unit}`);
  }

  const packages = readLock();
  const hash = createHash('sha256');
  const crates = [];
  const add = (label, value) => hash.update(`${label}\0${value}\n`);

  add('features', def.features.join(','));
  for (const name of lockClosure(def.crate, packages)) {
    const crateDir = join(CRATES_DIR, name);
    const isLocal = (packages.get(name) ?? []).some((p) => p.source === '') && existsSync(crateDir);
    if (!isLocal) {
      for (const p of packages.get(name) ?? []) {
        add('dependency', `${p.name} ${p.version} ${p.source} ${p.checksum}`);
      }
      continue;
    }

    crates.push(name);
    for (const file of listFiles(crateDir).sort()) {
      add(relative(REPO_ROOT, file).split(sep).join('/'), sha256(readFileSync(file)));
    }
  }
  for (const input of SHARED_INPUTS) {
    add(input, sha256(readFileSync(join(REPO_ROOT, input))));
  }

  return { sources: hash.digest('hex'), crates };
}

/** What the build records for a unit: its sources, its crates and its binary. */
export function currentBuildInfo(unit) {
  const { sources, crates } = sourceFingerprint(unit);

  return { sources, wasm: sha256(readFileSync(wasmPath(unit))), crates };
}

/** The record committed next to the unit's binary, or null when there is none. */
export function recordedBuildInfo(unit) {
  const path = join(unitDir(unit), BUILD_INFO_FILE);

  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}
