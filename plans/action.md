# CI — suggested improvements to the GitHub Actions checks (PLANNED, not scheduled)

> **Status: suggestions, 2026-11-17.** Deliberately postponed: nothing here
> should land while the pilot is running, so the pilot build stays as it is.
> Measurements were taken on 2026-11-17 with the pinned toolchain (Rust
> 1.96.0); file names and counts were accurate then — **check them again
> before starting**.

## Today

`.github/workflows/ci.yml` runs on pushes to `dev` / `main` and on PRs into
them. Three jobs:

- **check** — `npm run check` (Biome lint + format), `npm run typecheck`,
  `npm test` (vitest, incl. the wasm source fingerprint and wasm smoke
  tests), `npm run check:size`, `npm run build`, then `git diff --exit-code`
  so a build that regenerates a tracked file fails.
- **rust** — `cargo test --workspace --locked`, with the IFC samples fetched
  first.
- **version-gate** — PRs into `main` only: the PR must come from `dev`, the
  version must be the next `MAJOR.YY.RELEASE`, an unchanged version allows
  non-app files only, and the PR title must contain the version.

`rustfmt` and `clippy` are installed by `rust_src/rust-toolchain.toml` but
**nothing runs them** — no workflow, script or npm script. A green CI says
the Rust code compiles and its tests pass, nothing about format or lints.

## Suggestions

Ordered from smallest to largest. 1–4 are small edits to `ci.yml`; 5 is a
cleanup task of its own.

### 1. Run on every branch

CI never runs on a branch other than `dev` / `main`. In a fork that has no
`dev` (work happens on branches like `261117`) it never runs at all.
Run the `check` and `rust` jobs on a push to any branch, on PRs into `main`,
and on `workflow_dispatch`. The `concurrency` group already keys on the ref,
so branches don't cancel each other.

### 2. Add the boot test

`npm run test:boot` (`scripts/boot-test.mjs`) starts the dev server, opens
the app in headless Chrome with SwiftShader WebGPU and fails on any uncaught
page error. It is the only check that runs the hotkey table through
`validateBindings()` (duplicate or unparseable default keys throw at boot) —
vitest never imports `src/hotkeys/bindings.ts`. It passed locally; GitHub's
Ubuntu runners ship Chrome, which the script finds on
`PATH`. Add it to the `check` job after `npm test`.

### 3. CHANGELOG check

CLAUDE.md requires a CHANGELOG entry for every change; nothing enforces it.
Fail a PR (and a push to a branch) that changes app files but not
`CHANGELOG.md`. Reuse the version gate's file classification
(`.github/*`, `plans/*`, root Markdown = not app) so the two never disagree
— ideally move that `case` list into one small script both steps call.

### 4. The version gate in a fork

"PRs into `main` must come from `dev`" fails every PR in a fork that has no
`dev`. Either allow any head branch in the fork (keep the version rules), or
create `dev` in the fork and keep the original flow. Undecided.

### 5. Rust format and clippy — clean up first, then enforce

Turning `cargo fmt --check` and `cargo clippy -- -D warnings` on today
would fail CI. State on 2026-11-17:

- **`cargo fmt --all --check`** — 21 diffs.
- **`cargo clippy --workspace --all-targets --locked`** — 486 findings:
  2 errors, 484 warnings.

| Where | Count | What |
|---|---|---|
| `nwd-core` (test code) | 2 errors | `approx_constant`: `-0.7071` / `0.7071` in `src/geometry.rs` (~line 3283) — use `std::f32::consts::FRAC_1_SQRT_2` |
| `meshopt` (vendored) | 245 | 238 `doc_markdown`, because its `lib.rs` opts into Embark's strict lint list — third-party code, don't edit it; exclude it from the lint step |
| `step-core` | 98 | mostly `unnecessary_cast` (64: `x as f64` on an `f64`) |
| `rvm-core` | 69 | `needless_range_loop` (24), `identity_op` (16, mostly deliberate `* 1` / `+ 0` kept for aligned index tables) |
| `nwd-core` | 56 | `manual_is_multiple_of`, `needless_range_loop` |
| the rest | 16 | `cooker-core` 9, 1–2 each in `ifc-core`, `step-wasm`, `step-cli`, `ifc-wasm`, `rvm-wasm`, `nwd-dissect` |

Across all crates, besides the above: `type_complexity` 14,
`too_many_arguments` 4, about 25 small lints (`unnecessary_map_or`,
`needless_borrow`, `collapsible_if`, `map_entry`, …), and 9 plain compiler
warnings that only show with `--all-targets` (renamed lint names in `allow`
attributes, one unused variable, one unused import, lifetime syntax).

None of these looked like a real bug. One lint deserves a look per site:
`neg_cmp_op_on_partial_ord` (4) — `!(a < b)` on floats is **not** `a >= b`
when a value is NaN; it is usually deliberate NaN handling.

Order of work:

1. `cargo fmt --all`.
2. `cargo clippy --fix --workspace --all-targets --allow-dirty` for the
   mechanical lints, then fix the rest by hand (the 2 errors, the loops).
3. `#[allow]` the deliberate ones (`identity_op`, `type_complexity`,
   `too_many_arguments`) where they occur, with a short reason.
4. Rebuild the affected wasm modules (`node scripts/build-wasm.mjs <unit>`)
   and commit each with its `build-info.json` — any source change, even
   formatting, fails `tests/wasmSources.test.ts` until rebuilt. Run
   `tests/wasmSmoke.test.ts` too: the cooked output must not change.
5. Add to the `rust` job: `cargo fmt --all --check` and
   `cargo clippy --workspace --all-targets --locked --exclude meshopt -- -D warnings`.

Because step 4 replaces wasm binaries that ship to users, this belongs in a
quiet period after the pilot, as its own change with its own release.

## Smaller notes

- **Third-party notices freshness.** `npm run gen:notices` is not checked in
  CI, so a dependency change without regenerated notices goes unnoticed. It
  needs `node_modules` and the cargo registry, so it would fit in the `rust`
  job after `cargo test` (plus `npm ci`), followed by `git diff --exit-code`.
  Check that its output is deterministic on a runner before enforcing it.
- **Duplicate typecheck.** `npm run build` already runs `gen:docs` and
  `tsc --noEmit`, so the separate `typecheck` step repeats them. Keeping it
  gives a clearer failing step name; dropping it saves a little time.
- **Pages workflow on `main`.** `pages.yml` (deploy any branch to
  `gh-pages`) only exists on the branches that have it. Merging it into
  `main` makes every new branch deployable.
