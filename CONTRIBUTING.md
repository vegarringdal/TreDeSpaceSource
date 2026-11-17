# Contributing to TreDeSpace

How to work on the code, and how the maintainer cuts releases. What the viewer
is and how to try it is in the [README](README.md); the architecture is in
[DESIGN.md](DESIGN.md) and the host API in [EVENTS.md](EVENTS.md).

## Development setup

**Prerequisites**

- Node 24+ (current LTS) and npm (nvm recommended).
- Git.
- A Chromium-based browser with WebGPU (see the [README](README.md)).

On **Windows**, do everything inside **WSL2** (Ubuntu): install the tools in the
WSL shell, run the dev server there, and open its URL in a Windows Chrome (or in
Chrome installed inside WSL).

**Ubuntu / Debian**

```bash
sudo apt update && sudo apt install -y git curl build-essential
# Node via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 24
```

**Fedora**

```bash
sudo dnf install -y git curl @development-tools
# Node via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 24
```

**Run / build**

```bash
npm install
npm run dev      # Vite dev server — also serves the API demo at /demo/
npm run build    # tsc + vite → dist/
npm run preview  # serve the production build locally
npm run check    # Biome lint + format check (check:fix to autofix)
```

## Developing with Claude Code

**`.claude/settings.json` is permissive.** This repo is developed
with Claude Code inside a **locked-down VM**, so the checked-in Claude Code
config trades prompts for speed: it pre-approves broad shell commands
(`rm`, `mv`, `python3`, `node`, `npm`, `cargo`, …) and enables the sandbox with
the project directory, the Cargo registry / git caches and `/tmp` writable.
That is safe in a throwaway VM and **not** a recommendation for your everyday
machine.

- **The `deny` list is a guard-rail, not a boundary.** It states this project's
  rule that the maintainer owns merges and pushes (no `git push`, no history
  rewriting, no `sudo` / `curl` / `wget`), but the `allow` list includes
  interpreters and runners — `node`, `python3`, `find`, `xargs`, `env` — that
  can run any denied command.
- **The sandbox is the only real control, and it limits files, not the
  network.** Reads and writes are confined to the paths it lists; outbound
  network access is not restricted.

If you use Claude Code here, read `.claude/settings.json` first and trim the
`allow` list to what you are comfortable with; put personal changes in
`.claude/settings.local.json`, which is gitignored.

## Rebuilding the Rust → wasm modules

The cooker (`rust_src/`) and the
in-tree converters (`rust_src/crates/{rvm,ifc,step,nwd,scan}-*`) ship as prebuilt wasm in
`src/lib/<unit>/wasm/` (cooker, rvm2glb, ifc2glb, step2glb, nwd2tdp, scan2tdpp), so you don't need
Rust for normal
dev. To rebuild them you need the Rust toolchain plus `wasm-pack`, and a
wasm-capable clang for the bundled C++ meshoptimizer. The compiler is pinned in
`rust_src/rust-toolchain.toml`; rustup installs that version (wasm target
included) the first time you run cargo inside `rust_src/`:

```bash
# rustup: https://rustup.rs
cargo install wasm-pack
sudo apt install -y clang llvm        # Fedora: sudo dnf install clang llvm
npm run build:wasm                    # all six; or: node scripts/build-wasm.mjs cooker
```

`scripts/build-wasm.mjs` is the one recipe for every module (the list, with
each module's cargo features, is in `scripts/wasm-units.mjs`). Next to each
binary it writes `build-info.json`: a fingerprint of the Rust sources the
binary was built from and a hash of the binary itself.
`tests/wasmSources.test.ts` (part of `npm test`, no Rust needed) recomputes
both, so **a change to the Rust sources of a module fails the tests until
that module is rebuilt** — the committed wasm cannot silently fall behind its
source. A rebuild on another machine does not give the same bytes (the C++ is
compiled by the local clang), which is why the check compares sources and not
binaries. The script also keeps the builder's home directory out of the
binary's panic messages.

Tests for both sides, and CI runs both:

- `cd rust_src && cargo test --workspace`: the Rust tests. The IFC ones need
  `convertSamples/ifc/fetch-samples.sh` run once first.
- `npm test` includes `tests/wasmSources.test.ts` (above) and
  `tests/wasmSmoke.test.ts`, which loads the COMMITTED wasm
  and checks that each converter's import path cooks to the same bytes as the
  standalone cooker, and that the app's reader parses every output. It also
  pins the cooked bytes. After a rebuild that changes the cooked output on
  purpose, update them with `npx vitest run tests/wasmSmoke.test.ts -u`. If the
  test fails after a rebuild you didn't expect to change anything, the modules
  were built from different sources.

See [DESIGN.md](DESIGN.md) for the cooker/converter internals.

## Developer notes

- **The `/docs/` API reference is generated from the SDK — keep them in sync.**
  When you add, rename, or change a command on
  [`api/tredespace-client.ts`](api/tredespace-client.ts), give the method a JSDoc
  comment **and** add its `### command` section (with a fenced `payload:` /
  `response:` example) to [`EVENTS.md`](EVENTS.md). `npm run build` **fails** if
  a command is missing either — the reference is derived from both by
  `scripts/gen-api-docs.mjs`. The same check fails the build when a new API
  namespace has no `data-ns` tile in the product page's command grid
  (`docs/index.html`), and when an SDK method sends through a private helper
  that is not listed in `SENDERS` in `scripts/gen-api-docs.mjs`.
- **TypeScript stays on 6.x** (`"typescript": "6.0.3"`). TypeScript 7 ships no
  JavaScript compiler API, which both doc generators and the `apiDocs()` Vite
  plugin use — under 7 the build, the dev server and `test:boot` fail. Port
  `scripts/gen-api-docs.mjs` and `scripts/gen-widget-docs.mjs` before
  upgrading.
- **Third-party notices.** After any npm **or** Rust dependency change, run
  `npm run gen:notices` and commit `src/generated/third-party-notices.json` (it
  is *not* part of the build). A newly *vendored* crate (a copied lib under
  `rust_src/`, like `meshopt`/`tess2-rust`) also goes in the `VENDORED` list in
  `scripts/gen-third-party-notices.mjs`.
- **State pattern.** One `createStore` per domain plus a `*.actions` module that
  owns all mutation; persist to `localStorage` only where it matters.
- **Every button / checkbox / stepper gets a hotkey + tooltip** (`data-shortcut`
  renders the combo) — the app aims for exhaustive keyboard coverage.
- **Lint/format** with Biome: `npm run check` (`check:fix` autofixes). Prefer
  `?.` in UI code; reserve `!` for GPU invariants.

## Updating the user-guide screenshots

The user guide (`docs/guide/`) shows pictures taken from the running app.
They are committed, so the build never needs a browser — but they go stale
when a documented panel changes. `npm run docs:shots` retakes them; the full
description is in [docs/README.md](docs/README.md#user-guide-screenshots).

**1. Panel pictures only (no GPU needed)**

```bash
npm run docs:shots                      # every scene
npm run docs:shots -- --only scans      # one scene
npm run docs:shots -- --only f04,setColor
```

This runs a headless Chrome (from `$CHROME_BIN`, the `PATH`, or the puppeteer
cache — install one with `npx @puppeteer/browsers install chrome@stable`). It
has no real GPU, so pictures of the 3D view are skipped and keep their old
image.

**2. Pictures of the 3D view (real GPU)**

Start a Chromium with a real GPU as a **separate instance** with its own
profile folder and a debugging port, and leave its window open and uncovered:

```bash
# Chrome / Chromium installed normally
chromium --user-data-dir=$HOME/.cache/docshots-profile \
  --remote-debugging-port=9222 \
  --enable-unsafe-webgpu --enable-webgpu-developer-features --enable-features=Vulkan

# Flatpak (here Ungoogled Chromium; Flathub's Chromium is org.chromium.Chromium).
# The profile folder must be under ~/.var/app/<app id>/ — the sandbox can write there.
flatpak run io.github.ungoogled_software.ungoogled_chromium \
  --user-data-dir=$HOME/.var/app/io.github.ungoogled_software.ungoogled_chromium/docs-shots \
  --remote-debugging-port=9222 \
  --enable-unsafe-webgpu --enable-webgpu-developer-features --enable-features=Vulkan
```

Then, in the repo:

```bash
npm run docs:shots -- --browser-url http://127.0.0.1:9222
npm run docs:shots -- --only scans --browser-url http://127.0.0.1:9222
```

Every picture of the chosen scenes, panel and 3D view alike, is then taken in
that browser.

**Options**

| Option | What it does |
|---|---|
| `--only <ids>` | Only these scenes, comma-separated. The ids are `overview`, `f01` … `f12`, `a01`, `scans`, `settings`, `setColor`, `labels`, `measurements` — the scene's id, not its file name. |
| `--browser-url <url>` | Take the pictures in an already running browser with a GPU (see above) instead of headless Chrome. |
| `--app-url <url>` | Use an already running dev server instead of starting one. |
| `SCAN_SAMPLES=<folder>` | Where the `scans` scene finds `BLK360G1_Indoor_Office_classified 1.lgsx` (default: your download folder). Without the file the scene is skipped. |

**Things to know**

- Don't edit source files while it runs: Vite reloads the page and the scene
  fails. Rerun the scene.
- The `a01` scene needs the IFC samples, which are not in git: run
  `convertSamples/ifc/fetch-samples.sh` once.
- A scene fails when a numbered mark points at a control that is gone or
  renamed — fix the mark in `docs/guide/scenes/<scene>.mjs` and the matching
  number in the guide page.
- Commit what changed under `docs/guide/img/` and `docs/guide/data/`.

## Versioning and releases

The app uses a 3-part, SemVer-compatible hybrid CalVer version:
`MAJOR.YY.RELEASE`.

- **`MAJOR`** (`0`, `1`, `2`, …): product generation / stability stage.
  - `0`: pre-release / early development (`0.26.1`), while features are
    stabilised and edge cases caught.
  - `1`: the first stable public release (`1.26.1`).
  - `2` and up: reserved for major architectural rewrites or breaking
    format/data changes.
- **`YY`** (`26`, `27`, …): two-digit calendar year of the release (`26`
  for 2026).
- **`RELEASE`** (`1`, `2`, `3`, …): sequential, 1-based release counter for
  that year. It resets to `1` with the first release of a new year.

Rules for updating the version:

1. **Valid SemVer only.** Always three numeric segments with no leading
   zeros (`0.26.1`, `1.26.1`, `1.27.1`), so `package.json`, npm and release
   tools parse it cleanly.
2. **Release increments.** Each new app build/release within the same year
   increments `RELEASE` by 1 (`0.26.1` → `0.26.2` → `0.26.3`).
3. **Graduating to 1 (and any `MAJOR` bump).** At the stable launch, bump
   `MAJOR` from `0` to `1`, keep the current year and reset `RELEASE` to `1`
   (`0.26.3` → `1.26.1`). Every later `MAJOR` bump resets it the same way
   (`1.27.4` → `2.27.1`). The reset is required, so a mistyped `MAJOR` cannot
   pass as an ordinary release.
4. **New year rollover.** On the first release of a new calendar year,
   update `YY` and reset `RELEASE` to `1` (`1.26.5` → `1.27.1`).
5. **Non-app changes.** Do not bump the version or cut a release tag for
   documentation (`README.md`), comments, or CI/GitHub Actions tweaks that
   do not change the built application.

Branches: `dev` is the development branch. `main` only takes pull requests
from this repository's own `dev` (not a fork's), and only when CI passes —
tests, and the version gate (`.github/workflows/version-gate.yml`): the PR's
`package.json` version must be the next release by the rules above (`MAJOR`
the same or one up, `YY` the current year in UTC, `RELEASE` one up within the
year, or `1` in a new year or after a `MAJOR` bump) and the PR title must
contain it as a word of its own (`v0.26.1`; `v0.26.10` does not count). A PR
that changes only files the app is not built from — `.github/`, `plans/`,
`README.md`, `CHANGELOG.md`, `DESIGN.md`, `CLAUDE.md`, and Markdown outside
`src/` and `docs/` other than `EVENTS.md` — keeps the version unchanged; a
file moved out of `src/` or `docs/` still counts as an app change. The gate
cannot tell a comment-only change in code from any other, so such a change
waits in `dev` for the next release. After a merge, the container image is
built from `main` and tagged with that version (below).

Working from a fork: never commit to the fork's own `main` or `dev` — only
sync them from this repository ("Sync fork") — and cut work branches from
the synced `dev`. A fork's work goes into this repository by a pull request
from the work branch into `dev`; CI runs on it (after approval, read-only),
the version gate does not, since it only guards `main`. The deploy-any-branch
Pages workflow (`.github/workflows/pages.yml`) is meant for such a fork.

The gate runs from `main`'s copy of its workflow (`pull_request_target`), so
a PR cannot change the gate it is checked by, and a change to the gate takes
effect only once it is on `main`. It re-runs when the PR title is edited. It
never runs code from the PR — it reads the PR's `package.json` and file list
as git objects with a read-only token.

## Container images

The app ships as a static container. A node stage runs `npm run build`, then
rootless nginx serves `dist/` on port 8080. Unknown paths fall back to the app,
and doc pages also open without `.html` (`/docs/events`).

Building and running it locally is in the [README](README.md#run-it-yourself).

The image takes no runtime configuration (no env file, no config endpoint): a
host that embeds the viewer sets what it needs over the postMessage API
(`settings.*`, `externalApps.set`, … — see EVENTS.md).

Two manual GitHub workflows (Actions → *Run workflow*) build and push it. Both
call the shared `.github/workflows/container-image.yml`.

| Workflow | Runs from | Image | Tag |
|---|---|---|---|
| Container Prod image | `main` only | `<prefix>/tredespace-prod` | `package.json` version; an existing tag is never overwritten |
| Container Dev image | `dev` only | `<prefix>/tredespace-dev` | `DEVBUILD-<run number>`; only the newest 5 are kept (ghcr.io only) |

The tag is also the version the app shows (About, `/build.version`). It is
passed in as the `APP_VERSION` build argument; `package.json` is not changed.
Production images carry a build provenance attestation (SLSA, `mode=max`);
dev builds do not, so the keep-5 cleanup counts builds, not attestations.

### Security headers

nginx (`docker/nginx.conf`) sends with every response
`X-Content-Type-Options: nosniff` and
`Referrer-Policy: strict-origin-when-cross-origin`
(`docker/security-headers.conf`), and with every page — the viewer, `/docs/`
and `/demo/`, which share the origin — the `Content-Security-Policy` the build
also writes into each page as a meta tag (`docker/csp-header.conf`, from
`scripts/page-csp.mjs`; what it covers is in DESIGN.md › "Untrusted input &
CSP"). Workers and other assets get no CSP, on purpose.

- The referrer policy must keep sending the origin cross-origin: a tab the
  viewer opens for an External app reads the viewer's origin from
  `document.referrer` (EVENTS.md). `no-referrer` would break it.
- Each `location` includes the snippets itself: nginx drops the server's
  `add_header` lines in a location that has its own.
- `tests/securityHeaders.test.ts` fails when nginx's CSP and the build's
  differ, when a location misses the headers, or when the image stops copying
  the snippets.

### Pinned actions and images

Every GitHub Action is pinned to a commit SHA (the version in a comment) and
both base images to a digest (the tag kept for reading). Dependabot
(`.github/dependabot.yml`) opens weekly pull requests into `dev` with new SHAs
and digests; major versions are left to a deliberate change. Workflow
scripts never splice `${{ }}` expressions into shell code — values such as a
branch name or PR title arrive through `env:`. `tests/securityHeaders.test.ts`
checks both rules.

### Pushing to another registry (forks)

With nothing set, the images go to `ghcr.io/<repo owner>` using the
workflow's own `GITHUB_TOKEN`, so a fork works as-is once Actions are enabled
on it. To push somewhere else, add these under the repo's *Settings → Secrets
and variables → Actions*:

| Name | Kind | Value |
|---|---|---|
| `CONTAINER_IMAGE_PREFIX` | variable | Registry host + namespace, lowercase. The image name is appended. |
| `CONTAINER_REGISTRY_USERNAME` | secret | Registry user name |
| `CONTAINER_REGISTRY_PASSWORD` | secret | Password or access token |

- **Docker Hub:** prefix `docker.io/<user>`. The username is the Docker Hub
  user, and the password is a personal access token with Read & Write.
- **Azure Container Registry:** prefix `<registry>.azurecr.io`, optionally with
  `/<namespace>`. Use the user name and password of an ACR token with push
  rights, or a service principal's app id and secret.
- **ghcr.io under another owner** (e.g. an organization): prefix
  `ghcr.io/<owner>`, with a personal access token that has `write:packages`.
  Add `delete:packages` if the dev cleanup should run there too.

The dev cleanup (keep 5) only runs on ghcr.io. On other registries every dev
tag stays, unless you use that registry's own retention (e.g. `acr purge` on
Azure). On ghcr.io, if the server pulls without logging in, check the
package's visibility after the first push. If the dev cleanup fails with a
permission error, give this repo the *Admin* role under the package's
*Manage Actions access*.
