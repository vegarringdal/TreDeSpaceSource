# CI — suggested improvements to the GitHub Actions checks (PLANNED, not scheduled)

> **Status: suggestions, 2026-11-17.** Deliberately postponed: nothing here
> should land while the pilot is running, so the pilot build stays as it is.
> Measurements were taken on 2026-11-17 with the pinned toolchain (Rust
> 1.96.0); file names and counts were accurate then — **check them again
> before starting**. The version gate part is **done** (see "Version gate"
> below); its repository settings are still manual.

## Today

`.github/workflows/ci.yml` runs on pushes to `dev` / `main` and on PRs into
them. Two jobs:

- **check** — `npm run check` (Biome lint + format), `npm run typecheck`,
  `npm test` (vitest, incl. the wasm source fingerprint and wasm smoke
  tests), `npm run check:size`, `npm run build`, then `git diff --exit-code`
  so a build that regenerates a tracked file fails.
- **rust** — `cargo test --workspace --locked`, with the IFC samples fetched
  first.

`.github/workflows/version-gate.yml` gates PRs into `main` (rules in
CONTRIBUTING.md › Versioning and releases).

`rustfmt` and `clippy` are installed by `rust_src/rust-toolchain.toml` but
**nothing runs them** — no workflow, script or npm script. A green CI says
the Rust code compiles and its tests pass, nothing about format or lints.

## Suggestions

Ordered from smallest to largest. 1–3 are small edits to `ci.yml`; 5 is a
cleanup task of its own. (4, the version gate, is done.)

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
— ideally move that `case` list into one small script both steps call. The
gate must read that script from its own checkout of `main`, never from the
PR (see "Version gate").

### 4. Version gate — done 2026-11-17

Moved out of `ci.yml` into `.github/workflows/version-gate.yml` and
tightened. Decisions (director, 2026-11-17):

| # | Decision |
|---|---|
| G1 | Only this repository's own `dev` may open a PR into `main` — a fork's `dev` is refused, so everything goes through `dev`. |
| G2 | The gate runs on `pull_request_target`: main's copy always runs, so a PR cannot loosen it. It never runs PR code (git objects only, read-only token, no caches). |
| G3 | It re-runs when the PR title is edited. |
| G4 | A `MAJOR` bump must reset `RELEASE` to `1` (`0.26.3` → `1.26.1`), so a mistyped `MAJOR` fails. |
| G5 | Renames count by both paths: moving a file out of `src/` is an app change. |
| G6 | The version must be a word of its own in the PR title; `v0.26.30` is not `v0.26.3`. |
| G7 | `docs/` changes need a version bump (they change the published docs). |
| G8 | The year stays UTC. A release PR that hits the new-year edge just waits a few hours. |

Tested locally (2026-11-17) by running the step's script against throwaway
repos: next release, skipped release, `MAJOR` with and without reset,
`MAJOR` +2, wrong year, leading zero, title word matching, a title carrying
`$(…)` (not executed), unchanged version with `plans/` only / a `src/` change
/ a move out of `src/`, and the same-repo `dev` check. Not yet run on GitHub.

#### Rollout and repository settings (manual — GitHub settings, not files)

Work happens in a fork whose `main` / `dev` are never committed to — they
are only synced from the source repo, and work branches are cut from them.
Every PR goes from a fork branch into the **source repo's `dev`**; only the
source repo's own `dev` goes on into its `main`. So the settings below are
for the **source repo**; the fork needs none.

Order matters. The gate only runs from `main`'s copy, so the release PR that
first brings `version-gate.yml` to `main` runs no gate at all; if branch
protection already requires a `version-gate` check, that PR waits forever.

1. PR the work branch (with the gate) into the source repo's `dev`.
2. Merge `dev → main` as usual — this one release PR is not gated.
3. Then protect the source repo's `main`: require a pull request; require
   the status checks `check`, `rust` and `version-gate`; require branches to
   be up to date before merging; do not allow bypassing (admins included).
   Protect its `dev` too (require a pull request and `check` / `rust`), so
   fork work reaches it only through a reviewed PR. Branch protection on a
   private repository needs a paid GitHub plan.
4. Source repo, Settings → Actions → General: require approval before
   running workflows from fork pull requests for all external contributors.
   Fork PRs into `dev` then run CI only after approval, read-only and
   without secrets (the `check` / `rust` jobs must run the PR's code, so they
   stay on `pull_request`, never `pull_request_target`).
5. Optional: a `CODEOWNERS` entry for `/.github/` plus "require review from
   code owners", so every change to CI needs the owner's review.
6. After each release, sync the fork's `main` / `dev` from the source repo
   ("Sync fork") and cut new work branches from the synced `dev`.

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
- **Pages workflow on `main`.** `pages.yml` (deploy any branch of a fork to
  its `gh-pages`) only exists on the branches that have it. Once it reaches
  the source repo's `main` (via `dev`) and the fork is synced, every new
  work branch can be deployed.
