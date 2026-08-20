// Generate src/generated/third-party-notices.json — the license attribution
// data that Settings → About → "Show third-party notices" renders.
//
// Covers what actually SHIPS: the npm runtime-dependency closure (devDeps are
// excluded — they never reach the bundle) and the Rust crates baked into the
// cooker/rvm2glb wasm (from rust_src/Cargo.lock + the rvm2glb Cargo.tomls).
//
// Not run by the build — commit the output. Regenerate with `npm run gen:notices`
// after changing dependencies (needs node_modules installed and, for the Rust
// license texts, the crates present in ~/.cargo/registry).

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/generated/third-party-notices.json');

const readText = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const readJson = (p) => {
  const t = readText(p);
  return t ? JSON.parse(t) : null;
};

/** Canonical fallback texts for packages that declare an SPDX id but ship no
 *  LICENSE file (e.g. clsx). `{holder}` is filled from the package's author. */
const FALLBACK = {
  MIT: `MIT License

Copyright (c) {holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ISC: `ISC License

Copyright (c) {holder}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  'APACHE-2.0': String.raw`                              Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright (c) 2023 Biome Developers and Contributors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`,
};

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(-|\.|$)/i;

/** All LICENSE/COPYING/NOTICE texts in a directory, concatenated. */
function licenseTextFrom(dir) {
  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return null;
  }
  const hits = files.filter((f) => LICENSE_FILE.test(f)).sort();
  if (hits.length === 0) return null;
  return hits
    .map((f) => {
      const body = readText(join(dir, f));
      return body ? (hits.length > 1 ? `=== ${f} ===\n${body.trim()}` : body.trim()) : null;
    })
    .filter(Boolean)
    .join('\n\n');
}

const spdxOf = (lic) => (typeof lic === 'string' ? lic : (lic?.type ?? lic?.[0]?.type ?? null));
const holderOf = (pkg) => {
  const a = pkg.author;
  const name = typeof a === 'string' ? a.replace(/\s*<[^>]*>.*/, '').trim() : a?.name;
  return name || pkg.name;
};
const linkOf = (pkg) => {
  const r = pkg.repository;
  let url = (typeof r === 'string' ? r : r?.url) || pkg.homepage || '';
  url = url
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^(github|gitlab|bitbucket):/, (_, h) => `https://${h}.com/`);
  // bare "user/repo" shorthand → github
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  return url || null;
};

// ── npm: runtime-dependency closure (devDeps excluded) ──────────────────────
function collectNpm() {
  const rootPkg = readJson(join(ROOT, 'package.json')) ?? {};
  const queue = Object.keys(rootPkg.dependencies ?? {});
  const seen = new Set();
  const out = [];
  const resolveDir = (name, from) => {
    const nested = join(from, 'node_modules', name);
    if (existsSync(join(nested, 'package.json'))) return nested;
    const top = join(ROOT, 'node_modules', name);
    return existsSync(join(top, 'package.json')) ? top : null;
  };
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const dir = resolveDir(name, ROOT);
    if (!dir) {
      out.push({ name, version: '', license: null, link: null, text: null, kind: 'npm' });
      continue;
    }
    const pkg = readJson(join(dir, 'package.json')) ?? {};
    const spdx = spdxOf(pkg.license) ?? spdxOf(pkg.licenses);
    let text = licenseTextFrom(dir);
    if (!text && spdx && FALLBACK[spdx.toUpperCase?.()]) {
      text = FALLBACK[spdx.toUpperCase()].replace('{holder}', holderOf(pkg));
    }
    out.push({ name, version: pkg.version ?? '', license: spdx, link: linkOf(pkg), text, kind: 'npm' });
    for (const dep of Object.keys(pkg.dependencies ?? {})) if (!seen.has(dep)) queue.push(dep);
  }
  return out;
}

// ── rust: crates baked into the shipped wasm ────────────────────────────────
function cargoRegistryDirs() {
  const base = join(homedir(), '.cargo/registry/src');
  try {
    return readdirSync(base).map((d) => join(base, d));
  } catch {
    return [];
  }
}
const REGISTRY = cargoRegistryDirs();

function findCrateDir(name, version) {
  // exact `name-version` first, then a prefix match (Cargo.toml deps carry a
  // semver REQ like "0.7", not the resolved "0.7.0"), then highest available.
  for (const reg of REGISTRY) {
    if (existsSync(join(reg, `${name}-${version}`))) return join(reg, `${name}-${version}`);
  }
  const prefix = `${name}-`;
  const cands = [];
  for (const reg of REGISTRY) {
    let ents;
    try {
      ents = readdirSync(reg);
    } catch {
      continue;
    }
    // suffix must be a bare version (starts with a digit) — excludes sibling
    // crates like `meshopt-sys` when resolving `meshopt`
    for (const e of ents) if (e.startsWith(prefix) && /^\d/.test(e.slice(prefix.length))) cands.push(join(reg, e));
  }
  const startsWithReq = cands.filter((p) => p.split('/').pop().startsWith(`${prefix}${version}`));
  return (startsWithReq[0] ?? cands.sort().pop()) ?? null;
}

/** Primary permissive license we hold a canonical text for, from an SPDX expr. */
function fallbackText(spdx) {
  if (!spdx) return null;
  const up = spdx.toUpperCase();
  if (up.includes('MIT')) return FALLBACK.MIT;
  if (up.includes('ISC')) return FALLBACK.ISC;
  return null;
}

/** {name -> version} for every [[package]] with a registry source. */
function lockVersions(lockPath) {
  const lock = readText(lockPath);
  const map = new Map();
  if (!lock) return map;
  for (const block of lock.split(/^\[\[package\]\]$/m).slice(1)) {
    const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
    const source = block.match(/^\s*source\s*=\s*"([^"]+)"/m)?.[1];
    if (!name || !version || !source) continue; // path deps (our own crates) have no source
    // git-pinned crates (e.g. ifc-lite) carry their repo url + exact rev
    const git = source.startsWith('git+') ? source.match(/^git\+([^?#]+)\S*#([0-9a-f]+)$/) : null;
    map.set(name, { version, git: git ? { url: git[1], rev: git[2] } : null });
  }
  return map;
}

/** Names of third-party crates that actually LINK INTO a shipped wasm binary:
 *  cargo's dependency graph for the wasm target, minus [build-dependencies] and
 *  proc-macros (compile-time only, not in the binary). null if cargo is absent
 *  or the workspace can't be resolved — the caller then falls back. Workspace-own
 *  crates in the output are harmless: they have no lock `source`, so the caller's
 *  lock filter drops them. */
function shippedCrateNames(cwd, pkg) {
  try {
    const out = execSync(`cargo tree -p ${pkg} --target wasm32-unknown-unknown -e no-build,no-proc-macro --prefix none`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const names = new Set();
    for (const line of out.split('\n')) {
      const name = line.trim().match(/^([\w-]+)\s+v/)?.[1];
      if (name) names.add(name);
    }
    return names.size ? names : null;
  } catch {
    return null;
  }
}

/** License text for a git-pinned crate, from its cargo git checkout
 *  (~/.cargo/git/checkouts/<repo>-<hash>/<shortrev>/ — the LICENSE usually
 *  lives at the workspace root, not inside the published member crate). */
function gitCheckoutLicense(url, rev) {
  const repo = url.replace(/\/$/, '').split('/').pop();
  const base = join(homedir(), '.cargo/git/checkouts');
  let repos;
  try {
    repos = readdirSync(base).filter((d) => d.startsWith(`${repo}-`));
  } catch {
    return null;
  }
  for (const r of repos) {
    const dir = join(base, r, rev.slice(0, 7));
    const text = licenseTextFrom(dir);
    if (text) return text;
  }
  return null;
}

/** Direct deps (name + version) declared in a Cargo.toml's [dependencies]. */
function cargoTomlDeps(tomlPath) {
  const toml = readText(tomlPath);
  if (!toml) return [];
  const section = toml.split(/^\[dependencies\]$/m)[1]?.split(/^\[/m)[0] ?? '';
  const out = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^([\w-]+)\s*=\s*(.+)$/);
    if (!m) continue;
    if (m[2].includes('path')) continue; // workspace-internal crate
    const ver = m[2].match(/"([^"]+)"/)?.[1];
    if (ver) out.push({ name: m[1], version: ver.replace(/^[\^~]/, '') });
  }
  return out;
}

// Every shipped wasm binary. All of them live in the single rust_src workspace
// now (the converters used to have one workspace each under converters/), so
// `dir` is the same for all four and only the package differs. `lib` names the
// src/lib/<lib>/wasm folder holding the prebuilt artifact + copied manifests,
// used as the fallback when cargo can't resolve the workspace.
const WASM_WORKSPACES = [
  { dir: 'rust_src', pkg: 'cooker-wasm', lib: null, stem: null },
  { dir: 'rust_src', pkg: 'rvm-wasm', lib: 'rvm2glb', stem: 'rvm' },
  { dir: 'rust_src', pkg: 'ifc-wasm', lib: 'ifc2glb', stem: 'ifc' },
  { dir: 'rust_src', pkg: 'step-wasm', lib: 'step2glb', stem: 'step' },
];

// Vendored path crates that link INTO a shipped wasm but carry no registry
// `source`, so the cargo-tree/lock walk above can't find their license — list
// them explicitly, reading the LICENSE text straight from the in-tree copy.
// (Includes any third-party code THEY bundle, e.g. meshopt's C++ library.)
const VENDORED = [
  {
    // Rust FFI wrapper (Graham Wihlidal) bundling the C++ meshoptimizer library
    // (Arseny Kapoulkine); patched for freestanding wasm32. → cooker wasm.
    name: 'meshopt',
    version: '0.7.0',
    license: 'MIT OR Apache-2.0',
    link: 'https://github.com/gwihlidal/meshopt-rs',
    texts: [
      { path: 'rust_src/crates/meshopt', dir: true }, // LICENSE-MIT + LICENSE-APACHE (wrapper)
      { path: 'rust_src/crates/meshopt/vendor/LICENSE.md', label: 'bundled meshoptimizer (C++) — MIT, © Arseny Kapoulkine' },
    ],
  },
  {
    // Rust port of libtess2 (SGI Free Software License B, despite the crate's
    // "MIT" SPDX field); vendored fork. → rvm2glb + step2glb wasm.
    name: 'tess2-rust',
    version: '1.1.8',
    license: 'SGI-B-2.0',
    link: 'https://github.com/larsbrubaker/tess2-rust',
    texts: [{ path: 'rust_src/crates/tess2-rust/LICENSE' }],
  },
];

/** Concatenate license text from a vendored crate's listed dirs/files. */
function textFromPaths(entries) {
  const parts = [];
  for (const e of entries) {
    const full = join(ROOT, e.path);
    const body = e.dir ? licenseTextFrom(full) : readText(full);
    if (body) parts.push(e.label ? `=== ${e.label} ===\n${body.trim()}` : body.trim());
  }
  return parts.length ? parts.join('\n\n') : null;
}

function collectVendored() {
  return VENDORED.map((v) => {
    const text = textFromPaths(v.texts);
    if (!text) console.warn(`  ⚠ vendored ${v.name}: no license text found at ${v.texts.map((t) => t.path).join(', ')}`);
    return { name: v.name, version: v.version, license: v.license, link: v.link, text, kind: 'rust' };
  });
}

function collectRust() {
  const wanted = new Map(); // name -> {version, git}
  for (const ws of WASM_WORKSPACES) {
    const lock = lockVersions(join(ROOT, ws.dir, 'Cargo.lock'));
    const shipped = lock.size ? shippedCrateNames(join(ROOT, ws.dir), ws.pkg) : null;
    if (shipped) {
      // precise: only crates that link into this wasm binary, at lock versions
      for (const name of shipped) {
        if (lock.has(name) && !wanted.has(name)) wanted.set(name, lock.get(name));
      }
    } else if (ws.lib) {
      // workspace source or cargo unavailable → the copied core+wasm manifests
      // next to the prebuilt artifact (direct deps only — better than nothing)
      console.warn(`  ⚠ ${ws.dir}: no resolvable workspace — using copied manifests (direct deps only)`);
      for (const toml of [`${ws.stem}-core.Cargo.toml`, `${ws.stem}-wasm.Cargo.toml`]) {
        for (const d of cargoTomlDeps(join(ROOT, 'src/lib', ws.lib, 'wasm', toml))) {
          if (!wanted.has(d.name)) wanted.set(d.name, { version: d.version, git: null });
        }
      }
    } else {
      // the cooker workspace: fall back to its whole lock (over-inclusive)
      console.warn(`  ⚠ ${ws.dir}: cargo unavailable — falling back to the full Cargo.lock (includes build tooling)`);
      for (const [name, v] of lockVersions(join(ROOT, ws.dir, 'Cargo.lock'))) {
        if (!wanted.has(name)) wanted.set(name, v);
      }
    }
  }
  const out = [];
  for (const [name, entry] of [...wanted].sort((a, b) => a[0].localeCompare(b[0]))) {
    const { version: reqVersion, git } = entry;
    const dir = findCrateDir(name, reqVersion);
    // prefer the resolved crate's real version (toml deps carry a semver req)
    const version = dir ? (dir.split('/').pop().slice(name.length + 1) ?? reqVersion) : reqVersion;
    const meta = dir ? readText(join(dir, 'Cargo.toml')) : null;
    const spdx = meta?.match(/^license\s*=\s*"([^"]+)"/m)?.[1] ?? null;
    const repo = meta?.match(/^repository\s*=\s*"([^"]+)"/m)?.[1] ?? null;
    let text = dir ? licenseTextFrom(dir) : null;
    // git-pinned crates often keep the LICENSE at the workspace root, which the
    // published member crate doesn't include — read it from the git checkout
    if (!text && git) text = gitCheckoutLicense(git.url, git.rev);
    // some crates ship no LICENSE file but declare a permissive SPDX id
    if (!text) text = fallbackText(spdx)?.replace('{holder}', `The ${name} authors`) ?? null;
    // git-pinned crates link at their exact rev — for MPL-style licenses this
    // doubles as the "where to obtain the source" pointer (MPL-2.0 §3.2)
    const link = git ? `${git.url.replace(/\.git$/, '')}/tree/${git.rev}` : repo || `https://crates.io/crates/${name}`;
    out.push({
      name,
      version,
      license: spdx,
      link,
      text,
      kind: 'rust',
    });
  }
  return out;
}

const npm = collectNpm().sort((a, b) => a.name.localeCompare(b.name));
// vendored path crates first so they win a name clash with any registry entry
const rustByName = new Map();
for (const p of [...collectVendored(), ...collectRust()]) if (!rustByName.has(p.name)) rustByName.set(p.name, p);
const rust = [...rustByName.values()].sort((a, b) => a.name.localeCompare(b.name));
const packages = [...npm, ...rust];

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ packages }, null, 2)}\n`);

const missing = packages.filter((p) => !p.text);
console.log(`Wrote ${packages.length} packages (${npm.length} npm, ${rust.length} rust) → ${OUT}`);
if (missing.length) {
  console.warn(`  ⚠ ${missing.length} without license text: ${missing.map((p) => p.name).join(', ')}`);
}
