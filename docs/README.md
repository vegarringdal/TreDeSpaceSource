# docs/

Combined **product page + API reference + live demo** for embedding TreDeSpace.
Built by Vite (three page inputs) and served at `<host>/docs/`.

## Pages

- `index.html` — product pitch: hero, the nested-iframe architecture diagram,
  the three-panel deployment, security. Links out to the docs and the demo.
- `events.html` — the postMessage API reference. Hand-written narrative
  (principles / envelope / security), then a **command reference generated from
  the SDK**, then a types appendix. Offers the SDK for download.
- `demo.html` — the live mini-demo: embeds the real viewer and drives it.
- `guide/` — the **end-user guide**, one page per app layout
  (`f01-home.html` … `f12-assets.html`), shared panels on their own pages
  (`panel-*.html`) and `index.html` as the start page (layout overview + the
  App Layout ribbon). Prose is hand-written in the HTML; the pictures, marker
  boxes and reference tables come from `npm run docs:shots` (see "User-guide
  screenshots" below). Every `docs/guide/*.html` is a Vite input
  automatically; add new pages to the sidebar list (`GUIDE` in
  `guide/guide.ts`).
- `widgets.html` — live gallery of the `@treDeSpaceUI` component library
  (internal reference, not part of the embed API). React page; one vertical
  tab per widget with a live example + usage snippet. Its `widgets.css` scopes
  Tailwind scanning to the library + the page itself, so a widget that secretly
  depends on an app style renders broken here — that's the point.

## Supporting files

- `styles.css` — shared styling + palette/type tokens (used by all pages and
  the inline SVG).
- `theme.ts` — shared light/dark toggle (every page's top bar).
- `demo.ts` — live-demo logic (loads the gzipped Huldra sample, drives the SDK).
- `events.ts` — renders the generated reference and wires the SDK download.
- `widgets.tsx` / `widgets.css` — the widget gallery (imports only
  `@treDeSpaceUI` + `src/treDeSpaceUI/styles.css`, never app code). Each
  section renders a live demo, a complete stateful usage snippet (highlighted
  by the same no-dependency tokenizer style as the events page), and a props
  reference from `generated/widgetData.json`.
- `generated/widgetData.json` — **generated, git-ignored.** Every interface +
  type alias in `src/treDeSpaceUI` (widgets + dockable types) with per-member
  JSDoc, produced by `scripts/gen-widget-docs.mjs` (run by the `apiDocs()`
  Vite plugin on every dev start and build, or `npm run gen:widgetdocs`).
  Lenient, unlike the strict API docs: an undocumented prop just renders
  without a description — but writing JSDoc in the widget source is what
  makes the gallery's props reference useful.
- `tredespace-ui-<version>.tgz` — **build output only.** The `@tredespace/ui`
  npm package (MIT; compiled ESM + `.d.ts`, React 19 peer), assembled by
  `scripts/pack-ui.mjs` (`npm run pack:ui`, or the `uiPackage()` Vite plugin
  on build) and offered for download on the widgets page so hosts can depend
  on it via `"@tredespace/ui": "file:./libs/tredespace-ui-<version>.tgz"`.
  No package.json lives in `src/treDeSpaceUI` — the manifest, LICENSE, and
  package README are generated at pack time; the version follows the root
  package.json.
- `assets/architecture.svg` — the diagram as a standalone, deck-ready SVG.
- `generated/apiData.json` — **generated, git-ignored.** Produced from
  `api/tredespace-client.ts` by `scripts/gen-api-docs.mjs`.

## User-guide screenshots

`npm run docs:shots` (`scripts/doc-shots.mjs`) drives the real app with
puppeteer through every scene in `guide/scenes/*.mjs` (`_lib.mjs` holds the
shared helpers): each scene boots a fresh app in an incognito context,
imports Huldra sample RVMs from `convertSamples/rvm`, sets up a layout or
panel state and captures crops. Outputs, all **committed** (the build never
needs a browser):

- `guide/img/<shot>.webp` — one image per `<figure data-shot="<shot>">`.
- `guide/data/<scene>.json` — per shot: crop size and the numbered-marker
  boxes `guide.ts` draws over the image; per harvested panel: the control
  reference read from the live DOM (`data-tooltip` text, `data-shortcut`
  resolved to the current default combo, the button's icon), shown by
  `<div class="ref-table" data-ref="<key>">`.

Re-run it whenever a documented panel changes; `--only f04,setColor` limits
it to some scenes. A marker outside its crop or a missing element fails the
scene; a shot a scene no longer takes is removed with its image. Concurrent
runs queue on a lock file in the temp dir. Don't edit source files while it
runs: Vite reloads the page on a change, and a scene whose page reloaded fails
(rerun it).

Headless Chrome has no GPU, so the 3D view comes out blank. Shots marked
`gpu: true` are skipped headless (the old image is kept; until one exists the
page shows a "not captured yet" box); `gpu: 'prefer'` shots (full-screen
layouts) are taken headless until a GPU run has captured them. Capture them
from a Chrome with a real GPU started as a **separate instance** with
`--user-data-dir=<own dir> --remote-debugging-port=9222
--enable-unsafe-webgpu --enable-webgpu-developer-features
--enable-features=Vulkan` (Chrome ≥ 136 ignores the port on the default
profile, and the fresh profile has no `chrome://flags`; the
`chrome://inspect` "Allow remote debugging" toggle does not work — it serves
no `/json/version`), then
`npm run docs:shots -- --browser-url http://127.0.0.1:9222` (add
`--app-url <url>` to use an already-running dev server). Keep that window
uncovered while it runs — a covered window renders nothing new.

Adding a page: copy a layout page (e.g. `guide/f04-selection-color.html`) and
its scene; marks are element specs (`{ panel | within, section, tooltip |
text | re | css, nth }` — `section` matches a Collapsible or a ribbon group
title); `ctx.harvest(panel, { rename, skip, extra, key })` builds a reference
table. The "On this page" list builds itself from the page's
`<section class="g-sec">` `h2`/`h3[id]`.

## No-drift docs

The command reference is derived from the SDK, so it can't fall out of sync:

1. `scripts/gen-api-docs.mjs` parses `api/tredespace-client.ts` (TS compiler
   API) → each public method's JSDoc, signature, and the command it sends, plus
   the exported type shapes → `docs/generated/apiData.json`.
2. The `apiDocs()` Vite plugin regenerates that JSON on **every dev start and
   build**, and copies the SDK into the output as `dist/docs/tredespace-client.ts`.
3. `events.ts` renders the JSON.

So the source of truth is the SDK's own JSDoc — **document a command by writing
its doc comment in `tredespace-client.ts`.** `EVENTS.md` remains the canonical
protocol narrative (envelope, handshake, origin-check order). Regenerate the
JSON manually with `npm run gen:apidocs` if you want it before a build.

## View it

The demo needs the viewer, so serve it from the app (same origin):

```sh
npm run dev        # then open /docs/  (and /docs/events.html, /docs/demo.html)
npm run preview    # after npm run build
```

The product page and API reference render standalone; only the demo needs the
running viewer.
