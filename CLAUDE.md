# Project context for Claude




**Main project (this root): TypeScript/WebGPU CAD viewer** — React 19 + the
dockable panel shell, with the renderer as a library in `src/lib/`, organized
as one folder per domain (`render/` — `renderer.ts`, `shaders/` WGSL,
`camera.ts`; `model/` — `format.ts` cooked-model parser; plus `overlay/`,
`math/`, `opfs/`, `color/`, `sqlite/`, `modeldb/` (model DB worker), and
per-unit worker+wasm folders — `cooker/`, `rvm2glb/`, `ifc2glb/`, `step2glb/`).
GPU-driven rendering: cull compute → multi-draw indexed indirect
(`chromium-experimental-multi-draw-indirect`, Chrome with "Unsafe WebGPU" +
"WebGPU Developer Features" flags), two-pass HiZ occlusion, TAA, MSAA
per-sample edges, VBAO. Measured within 5-10% of the native Vulkan renderer.

- Build: `npm run build` (tsc + vite). Dev: `npm run dev`.
- Node lives at `~/.nvm/versions/node/*/bin` (npm not on default PATH).
- It renders cooked `.tdp` files (CADM v7-v9). Cooking now happens in-app
  (the Rust wasm cooker in `src/lib/cooker/wasm/`, source in `rust_src/`);
  GLB/RVM/IFC/STEP import runs in the browser via the Import Manager. The
  RVM/IFC/STEP converters live in the same `rust_src` workspace
  (`crates/{rvm,ifc,step}-*`) and cook straight to `.tdp` — only a plain GLB
  import goes through the cooker's GLB path. Sample models for their tests are
  in `convertSamples/`.
- **Third-party notices — regenerate on ANY dependency change.** After
  adding/updating an npm dep OR a Rust crate (this is a commercial,
  source-available product, so license attribution must stay complete), run
  `npm run gen:notices` and commit `src/generated/third-party-notices.json`.
  It is NOT part of the build.
  If a newly *vendored* third-party crate is added (a copied lib under
  `rust_src/`, like `meshopt`/`tess2-rust`), also add it to the
  `VENDORED` list in `scripts/gen-third-party-notices.mjs` — `cargo tree` can't
  attribute path deps. Always check this when dependencies move.  

- **CHANGELOG.md — add an entry for EVERY change.** The version in
  `package.json` is bumped by the director at release time; between bumps,
  each piece of work gets a bullet under a date heading so the diff between
  two versions reads as prose, not commits. Append at the TOP of the file:

  ```md
  - **YYYY.MM.DD** (>PACKAGEVERSION):
    Description — what changed and, when it matters, why.
  ```

  `PACKAGEVERSION` is the version currently in `package.json` (the entry is
  "after" that release). Several changes on one day share the date heading
  as separate lines. Write it in the same pass as the code.
  **Read `package.json` and today's date at the moment you write the entry**
  — the version is bumped often, so never copy the heading of the entry
  above: reuse an existing heading only when BOTH its date and its version
  still match; otherwise start a new heading on top.

- **postMessage API — changing the SDK requires updating the docs.** When you
  add, rename, or change a command on `api/tredespace-client.ts` (the copy-paste
  host SDK), you MUST also: (1) give the method a JSDoc comment, and (2) add/keep
  its `### command` section in `EVENTS.md` with a fenced ` ```js ` payload/response
  example. The `/docs/` command reference is *generated* from these two sources
  (`scripts/gen-api-docs.mjs`, run by the `apiDocs()` Vite plugin), so they never
  drift. **The build enforces it:** `vite build` fails if any command lacks JSDoc
  or an EVENTS.md example (dev only warns). `EVENTS.md` stays the canonical
  protocol narrative; the SDK's JSDoc is the source for per-command descriptions.

- **@treDeSpaceUI — changing the library requires updating the widget gallery.**
  `/docs/widgets.html` (`docs/widgets.tsx`) is a live demo of every widget in
  `src/treDeSpaceUI`. When you change anything there: (1) props docs come from
  the source's JSDoc via `scripts/gen-widget-docs.mjs` (auto-regenerated on
  dev/build — so give new/changed props a JSDoc comment); (2) a NEW widget
  needs a new gallery tab (live demo + stateful usage snippet), and a changed
  API needs its demo/snippet updated — this part is manual, nothing enforces
  it; (3) `src/treDeSpaceUI/README.md` is the library's **usage guide** — the
  narrative reference (setup, every widget's idioms, the dockable shell, the
  hotkey system) written so a person or an AI can build panels from that file
  alone. It is hand-written and nothing regenerates it, so a new widget, a
  renamed prop or a changed pattern must be reflected there too. Read it before
  building a new panel or dialog. The library must stay self-contained: the
  gallery imports only `@treDeSpaceUI` + `src/treDeSpaceUI/styles.css`, and its
  Tailwind scan is
  scoped to the library, so a widget leaning on an app style renders broken
  there. Library-level styles (theme vars, scrollbars) belong in
  `src/treDeSpaceUI/styles.css`, app-only styles in `src/styles.css`.
  The library also ships as the `@tredespace/ui` npm package (MIT) — never
  published to the registry: `scripts/pack-ui.mjs` compiles it (tsc,
  `tsconfig.lib.json`) and `npm pack`s a tarball that the build emits next to
  the gallery for download (consumers use `file:`) — so the library must keep
  compiling standalone, its runtime deps stay limited to
  react/react-dom (peers) + lit-html/@tabler/icons-react/clsx/tailwind-merge
  (update `RUNTIME_DEPS` in pack-ui.mjs if that list ever changes), and
  breaking API changes are breaking changes for external consumers too.

**Native reference renderer (removed).** The original Rust/Vulkan renderer that
this project ports from used to live in `vulkan_reference/`; it has been
removed from the repo. Its essentials — what was ported and what wasn't — are
summarised in `DESIGN.md` (see "Native reference (removed)"). When a rendering
feature needs the native details, consult `DESIGN.md` rather than a folder that
no longer exists.

## Working style

The director decides, Claude implements and pushes back when it disagrees. Show
a plan before multi-file changes. Never push, never destroy git history; the
director owns merges and pushes.


# React & TypeScript Style Guide

## General Rules
- Prefer functional components with named exports (no default exports).
- Explicitly type all props, function parameters, and return types.
- Never use `any`.
- Avoid `as` type assertions. Prefer proper typing, type guards, `unknown`, or `satisfies`.
- Use `as` only when no safe alternative exists, and keep assertions as narrow as possible.
- Prefer type aliases for unions and mapped types.
- Avoid enums; prefer string literal unions.
- Use readonly where appropriate.
- Narrow unknown values with type guards.

## Component Architecture
- Keep component files under ~120 lines.
  - Exceed this limit only when splitting the component would reduce readability or cohesion.
- Extract complex UI state or data fetching into custom hooks.
- Use Discriminated Unions for multi-step or conditional UI states.
- Follow SRP (Single Responsibility Principle): one component per file.
- Components must focus on rendering.
- Business logic should live in hooks or services.
- Avoid prop drilling beyond two levels.
- Custom hooks should return an object instead of arrays unless order matters.
- Use logical section headers for larger components, no not use /*xyz*/
```

  // -----------------------------------------------------------------------------
  // section name
  // -----------------------------------------------------------------------------

  code...

      // -----------------------------------------------------------------------------
  // section name
  // -----------------------------------------------------------------------------

  code...


 // with this order:
  1. Types
  2. Constants
  3. Hooks
  4. Derived state
  5. Helper functions
  6. Event handlers
  7. Effects
  8. Render

```

## State placement — `*.state.ts` / `*.actions.ts`

Shared state is a tiny `createStore` (`@treDeSpaceUI/lib/createStore`,
`useSyncExternalStore` under the hood). Each domain splits in two files:

- `<name>.state.ts` — the store and its state type only. Keep it
  JSON-serializable; live callbacks/resolvers belong in the actions module.
- `<name>.actions.ts` — **all** mutation, plus any non-serializable handles.
  Components call actions; they never call `store.set()` themselves.

Where the pair lives depends on who reads it:

- **Only one component/panel uses it** → keep it next to the `.tsx`, e.g.
  `src/components/dialogs/dialogs.state.ts` + `dialogs.actions.ts`.
- **Anything outside that folder needs it** (another panel, a hotkey, the
  postMessage API, a worker) → move it to `src/state/`, one folder per domain
  (`src/state/viewer/viewer.state.ts` + `viewer.actions.ts`).

Move the pair to `src/state/` at the moment the second consumer appears — don't
pre-place it there "just in case", and don't reach up into another component
folder's state file instead of moving it.

Not everything needs a store: state used by a single component stays in
`useState`/a custom hook. Reach for a store when the state outlives the
component, must be read outside React, or has more than one reader.

Persist to `localStorage` only where it matters, and do it in the actions
module.

## JSX & Code Cleanliness
- Use early returns instead of deeply nested ternaries or conditional blocks.
- Extract inline handlers if they exceed 2 lines of code.
- Prefer explicit props destructuring.

## Control Flow Formatting:
 - Always use explicit block statements (curly braces) for all `if` statements, 
even for single-line early returns. Do not write single-line `if (condition) return ...` without braces.

## Complex logic
When a function contains a non-obvious algorithm, add a short JSDoc comment
describing the intent and constraints before the function.

Avoid inline comments inside the algorithm unless a specific step is
surprising or non-obvious.

## Documentation
- Document exported functions, hooks, components, and complex algorithms with JSDoc.
- Do not document obvious code.
- Explain intent, assumptions, or constraints—not obvious implementation details.
- Keep comments up to date with the implementation.
- Remove commented-out code instead of leaving it in the file.



## Formatting
- Separate logical sections with one blank line.
- Avoid multiple consecutive blank lines.
- Keep related statements together.
- Insert a blank line after early returns.


## Reusability

- Avoid duplicated logic.
- Extract repeated logic into hooks, utilities, or shared components.
- Prefer composition over duplication.

## Constants

- Replace magic numbers and strings with named constants when reused or non-obvious.
Instead of
 `setTimeout(..., 250);`
prefer
`const SEARCH_DEBOUNCE_MS = 250;

## Naming
- Components: PascalCase
- Hooks: use*
- Utilities: camelCase
- Event handlers: handle*
- Helper functions: verb*
- Types: PascalCase
- Interfaces: PascalCase
- Constants: UPPER_SNAKE_CASE only for true constants
- Boolean variables should read naturally:
  - isLoading
  - hasChildren
  - canEdit
  - shouldRefresh


## Async & Error Handling

- Async functions must never throw expected application errors.
- Instead, return a `Result<T>` object.
- Only unrecoverable programming errors (e.g. invariant violations or impossible states) may throw.
- Always handle both the success and error cases explicitly.

```ts
type ErrorResult = Readonly<{
  err: unknown;
  msg: string;
}>;

type Result<T> = Readonly<{
  data?: T;
  error?: ErrorResult;
}>;
```

Example:

```ts
const result = await userService.load(id);

if (result.error) {
  toast.error(result.error.msg);
  return;
}

const user = result.data;
```