# TreDeSpace Web Viewer

Made by Vegar Ringdal

Using AI to speed up development to make a good-looking, fast 3D viewer — and to see what is possible. Very helpful for merging prev side projects into one bigger application.

Going for desktop-application feeling on the web. Graphics will be simple, no normals/texture. But app will be able to do a lot. Target is CAD/BIM models.


> All processing happens in your browser — models never leave your machine.

For better understanding/see it in action have a look at these links:

- [Product page](https://tredespace.com/docs/)
- [Iframe SDK](https://tredespace.com/docs/events)
- [Live demo](https://tredespace.com/docs/demo)
- [Widget UI](https://tredespace.com/docs/widgets)


## Versioning

> Still working on last checks/polish.

When app version model will will be per YY.NUMBER.0

So for first stable version in 2026, it will be "26.1.0", next will be "26.2.0"

`DEV` branch will be main developer branch

`MAIN` branch will only allow PR from `DEV` if it passes version check/test/linting etc.

After branch is merged, I will create a docker build (hosted at github) & update tredespace.


## Container images

The app ships as a static container. A node stage runs `npm run build`, then
rootless nginx serves `dist/` on port 8080. Unknown paths fall back to the app,
and doc pages also open without `.html` (`/docs/events`).

```bash
docker build -t tredespace .
docker run --rm -p 8080:8080 tredespace     # → http://localhost:8080
```

Two manual GitHub workflows (Actions → *Run workflow*) build and push it. Both
call the shared `.github/workflows/container-image.yml`.

| Workflow | Runs from | Image | Tag |
|---|---|---|---|
| Container Prod image | `main` only | `<prefix>/tredespace-prod` | `package.json` version; an existing tag is never overwritten |
| Container Dev image | `dev` only | `<prefix>/tredespace-dev` | `DEVBUILD-<run number>`; only the newest 5 are kept (ghcr.io only) |

The tag is also the version the app shows (About, `/build.version`). It is
passed in as the `APP_VERSION` build argument; `package.json` is not changed.

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



## Three parts, three licenses

- **The viewer** (`src/`, the app itself, and `rust_src/`, the Rust cooker
  and the RVM / IFC / STEP / NWD converters and the LGSX / E57 laser-scan
  cook, with their CLIs, C APIs and the prebuilt
  wasm under `src/lib/`) — **TreDeSpace License**: Elastic
  License 2.0 plus attribution and public-improvement terms. Use, modify and
  redistribute it, but no hosted/managed service for third parties, the About
  dialog's attribution stays, and source improvements you actually use must be
  published and offered back upstream as a pull request. The crates declare
  it as `LicenseRef-TreDeSpace`. The vendored forks `rust_src/crates/meshopt`
  and `rust_src/crates/tess2-rust` keep their own licenses, like every other
  third-party dependency.
- **The host SDK** ([`api/tredespace-client.ts`](api/tredespace-client.ts)) —
  **MIT**. A single copy-paste file host pages use to drive an embedded viewer
  over postMessage; not bundled into the app.
- **The widget library** (`src/treDeSpaceUI/`) — **MIT**. Standalone React
  widgets + dockable panel shell, free to embed anywhere. Never published to
  the npm registry: the build packs it as a `@tredespace/ui` `.tgz` offered for
  download from the widget gallery (`/docs/widgets.html`), which hosts depend on
  via `"@tredespace/ui": "file:…"`.

Full terms and third-party notices under [License](#license).


## How to get started with dev/how to build

For normal app development you only need **Node + Vite** — the Rust → wasm
modules are committed prebuilt, so Rust is optional (see the last block).

**Prerequisites**

- Node 24+ (current LTS) and npm (nvm recommended).
- Git.
- A Chromium-based browser with WebGPU (see [Requirements](#requirements)).

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

**Heads-up — `.claude/settings.json` is permissive.** This repo is developed
with Claude Code inside a **locked-down VM**, so the checked-in Claude Code
config trades prompts for speed: it pre-approves broad shell commands
(`rm`, `mv`, `python3`, `npm`, `cargo`, …) and enables the sandbox with the
project directory and the Rust/Node toolchain caches writable. That is safe in a
throwaway VM and **not** a recommendation for your everyday machine. If you use
Claude Code here, read `.claude/settings.json` first and trim the `allow` list to
what you are comfortable with — personal tweaks belong in
`.claude/settings.local.json`, which is gitignored. The `deny` list (no
`git push`, no history rewriting, no `sudo`/`curl`/`wget`) reflects this project's
rule that the maintainer owns merges and pushes.

**Optional — rebuild the Rust → wasm modules.** The cooker (`rust_src/`) and the
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
# e.g. the cooker (run from rust_src/):
CC=clang AR=llvm-ar wasm-pack build crates/cooker-wasm \
  --target web --release --out-dir ../../../src/lib/cooker/wasm
```

Tests for both sides, and CI runs both:

- `cd rust_src && cargo test --workspace`: the Rust tests. The IFC ones need
  `convertSamples/ifc/fetch-samples.sh` run once first.
- `npm test` includes `tests/wasmSmoke.test.ts`, which loads the COMMITTED wasm
  and checks that each converter's import path cooks to the same bytes as the
  standalone cooker, and that the app's reader parses every output. It also
  pins the cooked bytes. After a rebuild that changes the cooked output on
  purpose, update them with `npx vitest run tests/wasmSmoke.test.ts -u`. If the
  test fails after a rebuild you didn't expect to change anything, the modules
  were built from different sources.

See [DESIGN.md](DESIGN.md) for the cooker/converter internals.

## Repository layout

```
src/
  components/   React UI — dialogs + feature panels (the dockable shell lives
                in treDeSpaceUI/dockable/)
  lib/          one folder per domain (messageApi/ = the postMessage host API:
                listener, transport, per-domain handlers) + small flat utils
    render/     renderer.ts (GPU pipeline), shaders/ (WGSL, one module per pass
                family), camera.ts, device.ts, measureSnap.ts (snap classifier)
    overlay/    view/clip gizmos, label + measure overlays
    model/      format.ts (cooked-model parser), pack.ts, GLB/IFC export writers
    math/       m4.ts, quat.ts, project.ts
    opfs/       OPFS file-system helpers
    color/      color names / hex parsing / multi-color rules
    sqlite/     OPFS SQLite VFS + SQL helpers
    modeldb/    model DB worker (hierarchy, selection, export geometry)
    cooker/     GLB → .tdp cooker: worker + prebuilt wasm (merged rvm2glb
                files) + TS cook for standard / instanced glTF
    rvm2glb/    RVM converter — comlink worker + prebuilt wasm
    ifc2glb/    IFC converter — comlink worker + prebuilt wasm
    step2glb/   STEP converter — comlink worker + prebuilt wasm
    nwd2tdp/    Navisworks NWD / NWC converter — comlink worker + prebuilt wasm
    scan2tdpp/  LGSX / E57 laser scan → .tdpp cook — coordinator worker,
                sub-workers + prebuilt wasm
    tdpp/       .tdpp reader, point LOD selection and snapping
  state/        one createStore per domain + *.actions (mutation): viewer, assets,
                stores, labels, measurements, …
  hotkeys/      hotkey bindings (every control gets a hotkey + tooltip)
  treDeSpaceUI/ standalone UI/widget library — shipped as the @tredespace/ui
                npm package; must keep compiling on its own (see CLAUDE.md)
  generated/    generated files (third-party notices) — do not edit
api/            tredespace-client.ts — copy-paste host SDK (NOT app-bundled)
docs/           product page + generated API reference + live demo → dist/docs/
demo/           postMessage API playground host page → dist/demo/
public/         static assets copied as-is (robots.txt)
samples/        demo assets (Huldra GLB, license PDF) — gzipped at build time
rust_src/       Rust workspace: the wasm cooker AND the RVM/IFC/STEP/NWD import
                converters (crates/{rvm,ifc,step,nwd}-{core,cli,wasm,capi}) →
                src/lib/<unit>/wasm/ — the converters cook straight to .tdp;
                crates/scan-{core,cook,cli,wasm} read LGSX / E57 laser scans
                and cook them to .tdpp (format: crates/scan-cook/docs/)
convertSamples/ sample RVM/IFC models the converter tests run against
scripts/        doc/notice generators (gen-api-docs, gen-widget-docs,
                gen-third-party-notices), pack-ui (npm tarball), checks
                (boot-test, check-component-size, parse-test)
plans/          parked/planned feature designs + dated review notes
EVENTS.md       postMessage protocol + command catalog
DESIGN.md       architecture / rendering / cooked-format notes
```

## Developer notes

- **The `/docs/` API reference is generated from the SDK — keep them in sync.**
  When you add, rename, or change a command on
  [`api/tredespace-client.ts`](api/tredespace-client.ts), give the method a JSDoc
  comment **and** add its `### command` section (with a fenced `payload:` /
  `response:` example) to [`EVENTS.md`](EVENTS.md). `npm run build` **fails** if
  a command is missing either — the reference is derived from both by
  `scripts/gen-api-docs.mjs`.
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

## Design/Events/api

- **[DESIGN.md](DESIGN.md)** — architecture, the GPU-driven render pipeline, the
  cooked `.tdp` format, the wasm cooker + import converters, and what is /
  isn't ported from the original native renderer.
- **[EVENTS.md](EVENTS.md)** — the **postMessage host API**: envelope, the
  origin/security allowlist, the full command catalog, and the app → host
  events. The viewer can be embedded in an iframe (or opened as a window) and
  driven by a host page.
- **[api/tredespace-client.ts](api/tredespace-client.ts)** — a dependency-free,
  fully typed SDK you copy into your host app (correlation ids, the ready
  handshake, timeouts and transferables handled; one method per command).
- **Live demo** — served at `/demo/` in dev (and built into `dist/demo/`): it
  embeds the app and drives every command/event with a request/response log.
  `/demo/?dialog=1` is the same page hosted *inside* the viewer — add it as an
  External app under **Settings → External**.

## Requirements

A recent Chromium-based browser with WebGPU. For the full multi-draw indirect
render path, enable *Unsafe WebGPU* and *WebGPU Developer Features* in
`chrome://flags`.

## License

© 2026 Vegar Ringdal. Licensed under the **TreDeSpace License**: the
[Elastic License 2.0](https://www.elastic.co/licensing/elastic-license) with
additional attribution and public-improvement terms. See [`LICENSE`](LICENSE)
for the full text.

In short: you may use, copy, modify, and redistribute the software, but you
may not provide it to third parties as a hosted or managed service, the
About dialog's attribution ("TreDeSpace Web Viewer", "Made by Vegar Ringdal")
must be preserved in all copies and derivative works, and if you improve the
source code and use those improvements, you must publish them and offer them
back upstream as a pull request (the licensor decides whether to merge). It is provided as-is,
without warranty of any kind — use at your own risk. The copy-paste host SDK
([`api/tredespace-client.ts`](api/tredespace-client.ts)) and the
`@tredespace/ui` widget library are MIT-licensed and free to embed anywhere.

This app depends on third-party open-source packages, each under its own
license. Only dependencies whose licenses permit use in a proprietary product
are included; their notices are bundled and viewable in the app under
**Settings → About → Show third-party notices** (generated from the shipped
dependency tree by `scripts/gen-third-party-notices.mjs` into
`src/generated/third-party-notices.json`).
