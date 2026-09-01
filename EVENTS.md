# EVENTS.md — postMessage API (v1, implemented)

The app can be hosted in an iframe (or opened by a parent window) that drives
it with `postMessage` and reads results back. This document is the protocol
reference; the implementation is a thin validated adapter
(`src/lib/messageApi.ts` + wiring in `App.tsx`). A demo host page lives at
`/demo/` in dev (`demo/index.html` + `demo/main.tsx`) — it embeds the app in an
iframe and drives every command through the SDK with a request/response log.
`/demo/?dialog=1` is the same page for hosting INSIDE the viewer (add it as an
External app panel): no iframe, just the controls + console, and the SDK
targets `window.parent`. Since `app.ready` was announced before such a panel
existed, it pings with `settings.get` instead of waiting for the handshake.

**Host SDK:** hosts don't have to hand-write envelopes —
[`api/tredespace-client.ts`](api/tredespace-client.ts) is a dependency-free,
fully typed client class they COPY into their own codebase (correlation ids,
ready-handshake, timeouts and transferables handled; one typed method per
command below). It is not part of the app build; keep it in sync with this
document when the protocol evolves.

```ts
import { TredespaceClient } from './tredespace-client';

const client = new TredespaceClient(iframe, { targetOrigin: 'https://viewer.example.com' });
await client.ready();
await client.colorRulesSet(
  [{ filters: [{ op: 'append', mode: 'contains', value: 'PIPE' }], color: '#ff8800' }],
  { run: true },
);
const { fullnames } = await client.selectionGet();
```

## Principles

- **Request/response, always.** Every inbound command gets exactly one
  response message with the same `id` — success or error — so the host can
  chain work ("when done, do X"). No fire-and-forget.
- **Versioned envelope.** Both directions carry `tredespace: 1` (protocol
  version) so hosts and app can evolve.
- **Origin allowlist.** The app ignores messages unless the sender origin is
  allowed. Checked live per message, in order: master switch
  (Settings → External → API security, "Enable postMessage API" — off means
  ALL API messages are dropped, same-origin included) → same-origin →
  origins configured in that settings section → origins of configured
  External-app panels (embedded iframes post to `window.parent` and are
  allowed automatically) → the embed-time URL parameter
  (`?apiOrigins=https://portal.example.com,https://other.example.com`),
  honored only while "Allow ?apiOrigins= URL parameter" is on (default on;
  turn it off for a strict settings-only allowlist). **Inside an iframe** the
  parameter is trusted as-is: the browser partitions storage per embedding
  site, so an embedder only ever sees the empty viewer it is talking to itself.
  **In a window another page opened** (`window.open`) the viewer has the user's
  real local data, so there the parameter is only a request — the user is asked
  to Allow/Deny those origins; Allow saves them to the settings list (removable
  there) and then sends `app.ready` to the opener. A top-level window nobody
  opened ignores it. `*` is possible in an iframe but discouraged, and is never
  granted through the prompt. Responses are posted back with the sender's
  origin as `targetOrigin` — never `*`.
- **postMessage is the ONLY channel.** Cross-origin frames can never touch
  the app's DOM, globals, or storage — the browser isolates them. The attack
  surface is exactly the validated command list below; there is no eval, no
  HTML injection path, and payload strings are only ever used as data.
- **Payloads are JSON** except file bytes, which ride as `ArrayBuffer`
  transferables (zero-copy).
- **No trust in payloads.** Every payload is validated; malformed input →
  error response, never a crash.

## Envelope

Host → app:

```js
iframe.contentWindow.postMessage({
  tredespace: 1,
  id: 'req-42',            // host-chosen correlation id (string)
  type: 'selection.set',   // command name, see catalog
  payload: { ... },
}, 'https://viewer.example.com');
```

App → host (exactly one per request):

```js
// success
{ tredespace: 1, id: 'req-42', type: 'selection.set:result', ok: true,
  payload: { matched: 12, missed: ['/SITE/UNKNOWN'] } }
// failure
{ tredespace: 1, id: 'req-42', type: 'selection.set:result', ok: false,
  error: { code: 'bad-payload', message: 'fullnames must be a string[]' } }
```

Error codes: `bad-payload`, `not-ready`, `busy` (import lock held),
`not-found`, `internal`.

## Handshake

The app announces readiness once boot completes (renderer initialized,
assets index read):

```js
// app → host, unsolicited, id: null
{ tredespace: 1, id: null, type: 'app.ready', ok: true,
  payload: { version: '0.0.10', api: 1 } }
```

Hosts should queue commands until `app.ready` (commands before it get
`{ code: 'not-ready' }`).

## Command catalog (v1)

> Each `### command` heading below MUST carry a fenced ` ```js ` block with a
> `payload:` / `response:` example — the `/docs/` reference is generated from
> these (and the SDK's JSDoc), and `vite build` fails if a command is missing
> one. A heading may list sibling commands (`a.set / a.add`); they share the
> example. See CLAUDE.md → "postMessage API".

### selection.set
Replace the selection by fullnames (reveals the first hit in the tree —
same as the internal `selectByFullnames`). `append: true` ADDS to the current
selection instead of replacing it, so a host can build a selection up over
several calls (each call still reveals its own first hit).

```js
payload:  { fullnames: ['/TP400-PIPE-01', '/TP400-PIPE-02'], append: false }
response: { matched: 2, missed: [] }
```

### selection.clear
```js
payload:  {}
response: {}
```

### selection.get
`count` is the number of selected items (children included); `fullnames` are
the selection ROOTS — what was clicked or set, each standing for its subtree.
Roots are empty after an invert, a viewport rectangle select or a SQL
selection (nothing was "clicked"), so pass `items: true` to get every selected
**node** instead: each hierarchy entry whose items are all selected — the
leaves with geometry AND the grouping entries above them (assembly, frame
and template rows that own no mesh of their own), i.e. every row the tree
highlights. Why nodes and not just leaves: the *real* tag is often carried by
a parent or folder row (an assembly, an equipment group), and which level that
is varies per model — so a host resolving "what is selected" needs every
level and decides itself. `skip` drops names that START WITH any given prefix
(case-insensitive, trailing `*` accepted) so structure-only rows (frames,
brackets, templates) can be left out. Capped at `maxItems` (default 10 000); `itemCount` is the true total
after skipping and `truncated` says the cap hit.

```js
payload:  {}
response: { count: 3, fullnames: ['/TP400-BEAM-01'] }            // selection roots

payload:  { items: true, skip: ['FRAME', 'BRACKET*', 'TEMPLATE'], maxItems: 50000 }
response: { count: 3, fullnames: ['/TP400-BEAM-01'],
            items: ['/TP400-BEAM-01', '/TP400-PLATE-01', '/TP400-PLATE-02'],
            itemCount: 3 }                                          // truncated: true when capped
```

### labels.set / labels.add
Replace / append scene labels. Two anchor forms: a world-space point, or a
`fullname` (anchored to the item's bounds center — the tag-import path).

```js
payload: { labels: [
  { text: 'Check **this** flange', fullname: '/TP400-PIPE-01' },
  { text: 'Hand note', anchor: [12.5, 3.2, 8.0] },
] }
response: { added: 2, missed: [] }   // missed = unresolvable fullnames
```

### labels.clear
```js
payload:  {}
response: {}
```

### measurements.set / measurements.add
Replace / append measurements (world-space points; same shapes as the
measurements JSON export).

```js
payload: { measurements: [
  { kind: 'line', points: [{ pos: [0,0,0] }, { pos: [0,0,2.5] }], label: 'riser' },
] }
response: { added: 1 }
```

### measurements.clear
```js
payload:  {}
response: {}
```

### colorRules.add / colorRules.set
Append to / replace the Set Color editor's rules (same shape as the rules
JSON file). `run: true` also runs them immediately. The top-level `mode` is
`reset` (clear existing overrides first), `append` (layer on top) or `hide`
(hide everything — the rules unhide and colour only what they match).
Filter `mode` is one of
`contains`, `single` (equals; `*` wildcard at start/end), `starts`, `ends`,
`wildcard` (equals with `*` wildcards anywhere, e.g. `/85*pump*01`) or
`multi` (one name per line, each matched exactly) — all case-insensitive.
A filter's optional `level` (1-9) applies the filter to the NAMES at that
hierarchy level (tree-panel counting, import folders included) — each match
includes its whole subtree. Level 1 tests the import-folder name, so a hit
takes everything under the folder; the models' root entries sit at
folderDepth+1. Omitted/0 = match at any level.
A rule's optional `store` scopes it to the models loaded from that store
(a known store name, see `assets.stores`; omitted/'' = every store) — keeps a
rule set safe when two stores hold same-named models. An unknown name is
rejected with `not-found` rather than silently matching nothing.
A `multi` line may carry its own colour after a TAB/space/comma —
`name<TAB>#ff0000:50` (colour[:opacity 0-100], `default` = original colour) —
which is how a per-row colour list is fed in.

```js
payload: { mode: 'append', run: true, rules: [
  { comment: 'inspection', enabled: true, color: '#ff8800', opacity: 1, store: 'main',
    filters: [{ op: 'append', mode: 'contains', value: 'PIPE', comment: '', level: 3 }] },
  { comment: 'per-row colours', color: null,
    filters: [{ op: 'append', mode: 'multi', value: '/TP400-PIPE-01\tred\n/TP400-PIPE-02\t#00ff00:50' }] },
] }
response: { rules: 3, ran: true, matches: [192308, 2] }
```

### colorRules.apply
Run a rule set DIRECTLY — same payload shape as `colorRules.set` (rules,
`mode` defaulting to `reset`, `store`/`level`/`multi` all honoured), but the
Set Color panel's own rules and mode are NOT touched: nothing appears in the
GUI and nothing needs cleaning up afterwards. This is the form external
tooling should use to drive colours — the user's own rule set in the panel
stays exactly as they left it (`colorRules.set` is for hosts that want the
rules visible and editable in the panel). Disabled rules are skipped;
`matches` are the per-enabled-rule item counts. The paint itself is the same
one step on the undo stack a panel Run makes.

```js
payload: { mode: 'reset', rules: [
  { color: '#ff8800', filters: [{ op: 'append', mode: 'contains', value: 'PIPE' }] },
] }
response: { ran: true, matches: [192308] }
```

### colorRules.run / colorRules.clear
```js
payload:  {}
response: { matches: [12, 90] }   // run; clear responds {}
```

### settings.get
Read-only snapshot of the viewer settings (the persisted `viewerState`
shape) plus app info.

```js
payload:  {}
response: { version: '0.0.10', viewer: { sketch: false, geoEdges: true, ... } }
```

### view.sketch
Toggle sketch mode (white background + edge lines — the Home ribbon toggle),
or set it explicitly with `on`. Omit `on` to flip the current state.

```js
payload:  {}            // toggle   — or { on: true } / { on: false } to set
response: { sketch: true }
```

### view.screenshot
Capture the viewport as a PNG — the converged frame (edges, AA, AO, view cube)
plus the label and measurement overlays, exactly as shown. The viewer waits for
TAA/AO to finish accumulating before grabbing the pixels, so a busy scene may
take a moment. Returns a `data:image/png` URL (usable straight as an `<img>`
src or a download href) and the captured pixel size.

```js
payload:  {}
response: { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAA…', width: 1920, height: 1080 }
```

### assets.list
What is in the asset manager. `store` (optional, must be a known name) lists
just that store; omit it to list every store's assets. Each asset carries its
`store`.

```js
payload:  { store: 'main' }   // or {} for all stores
response: { assets: [
  { id: 'mdl8f2-k3j9x', store: 'main', name: '/TP400', folder: 'Model1.rvm/TP400',
    fileName: '_TP400-PIPE.glb', md5: '9e107d9d372bb6826bd81d3542a419d6',
    size: 812345, kind: 'merged', hasNormals: false, edges: true, loaded: true },
] }
```

`md5` is the MD5 of the source bytes (for RVM/IFC/STEP: the converted GLB) — a
host can compare it against its own to decide whether a re-import is needed.

### assets.import
Send a file to be converted/cooked into the asset manager. Bytes ride as a
transferable; `format` picks the pipeline; `store` (optional, default 'main',
must be a known name) is the destination store. `replace: true` deletes any
PRIOR asset sharing the new one's store + folder + name — done AFTER the
import succeeds, so a failed import never removes anything. Responds when the
import (which may be long — RVM/IFC conversion) finishes. Only one import runs
at a time (`busy` error otherwise, same as the UI's import lock).

`meta` (any JSON object) is stored with every asset the import produces and
comes back verbatim from `assets.list` — the viewer never interprets it. Use it
for host bookkeeping the viewer has no concept of, e.g. the md5 of the
COMPRESSED artifact you actually serve. A converter that yields several assets
from one file tags them all. It works the same on `assets.importUrl` (per
file), `sql.import` and `sql.importUrl` (per file).

`format: 'tdp'` is an already-cooked TreDeSpace file (a viewer export, or a
server-hosted model): it is stored as-is — no conversion — and the viewer
rebuilds its coarse (VRAM-budget) variant from the same bytes during the
import. The recorded `md5` is the hash of the `.tdp` bytes themselves, so a
host syncing hosted `.tdp` files can compare manifest hashes directly against
`assets.list`.

`bytes` is the file's `ArrayBuffer` (transferred, so unusable in the host after)
or a `Blob`/`File` (passed by reference); the SDK lists it as a transferable and
chunk-streams Blobs ≥ 500 MB for you.

```js
payload:  { fileName: 'pump.glb', folder: 'external', store: 'project-x',
            replace: true,                // drop a prior same store/folder/name asset
            format: 'glb-standard',        // 'glb-merged' | 'glb-standard' | 'rvm' | 'ifc' | 'step' | 'tdp'
            bytes,                         // ArrayBuffer | Blob (rides as a transferable)
            options: { normals: true, edges: true },   // per-format options
            meta: { zipMd5: 'a1b2…', rev: 42 } }       // yours, returned by assets.list
response: { entries: [{ id: '...', store: 'project-x', name: 'pump', md5: '…',
                        size: 40213, kind: 'standard', hasNormals: true }],
            replaced: 1 }                  // # of prior assets removed by replace
```

### assets.importUrl
Batch-import files the **viewer downloads by URL** — nothing rides postMessage,
so a host can queue many/large models without shipping their bytes across the
frame. Each file names its own `format` (required — a `.glb` URL is ambiguous
between merged and standard, so nothing is inferred on the wire). `store`
(default 'main', must be known) and `replace` apply to every file.

The whole batch takes the app's import lock ONCE. `concurrent` (default 3,
clamped 1..8) files are then processed at a time **end-to-end**: for
`glb-merged` / `glb-standard` / `tdp` each slot downloads AND cooks on a
cooker-pool worker, so downloads and conversions overlap and a slow download
never stalls a cook that is ready to run. The `rvm` / `ifc` / `step`
converters are multi-phase and stage through shared temp dirs, so they run one
after another inside the same batch.

`progress: true` (the SDK sets it whenever you pass `onProgress`) puts the
viewer in QUIET mode: it drives **no import dialogs at all**, leaving the
progress UI entirely to the host. Without it the viewer shows its usual import
overlay.

URLs are fetched under the **viewer** origin's CORS, not the host's. One
`results` entry per input file, in order; a download or convert failure is
recorded on that entry and never aborts the batch (`imported` + `failed` =
files).

While it runs the viewer posts unsolicited `assets.importUrl:progress` events —
`{ batchId, completed, total, index, url, phase, loaded?, totalBytes? }`.
`index` is the file's position in the `files` array (files run in parallel, so
ticks for several indexes interleave — key your UI on `index`, not on arrival
order). `phase` is one of `download` (repeats as bytes arrive, carrying
`loaded` and — when the server sent a content-length — `totalBytes`),
`convert` (the cook started), `done` or `error`. `batchId` is echoed so a host
can correlate them (the SDK's `onProgress` does this for you).

```js
payload:  { files: [
              { url: 'https://cdn.example.com/pump.rvm', format: 'rvm', folder: 'plant' },
              { url: 'https://cdn.example.com/frame.ifc', format: 'ifc' },
              { url: 'https://cdn.example.com/valve.glb', format: 'glb-standard',
                options: { normals: true, edges: true } },
              { url: 'https://cdn.example.com/site.tdp', format: 'tdp' } ],  // pre-cooked, stored as-is
            concurrent: 3, store: 'project-x', replace: true, progress: true }
response: { imported: 3, failed: 1, results: [
              { url: 'https://cdn.example.com/pump.rvm', ok: true, replaced: 0,
                entries: [{ id: '...', store: 'project-x', name: 'pump', kind: 'merged' }] },
              { url: 'https://cdn.example.com/frame.ifc', ok: true, replaced: 1,
                entries: [{ id: '...', store: 'project-x', name: 'frame', kind: 'merged' }] },
              { url: 'https://cdn.example.com/valve.glb', ok: false,
                error: 'download failed: HTTP 404 Not Found' },
              { url: 'https://cdn.example.com/site.tdp', ok: true, replaced: 0,
                entries: [{ id: '...', store: 'project-x', name: 'site', kind: 'merged' }] } ] }

// progress events while it runs
{ tredespace: 1, id: null, type: 'assets.importUrl:progress',
  payload: { batchId: 'ts-x1-batch-1', completed: 1, total: 4, index: 2,
             url: 'https://cdn.example.com/valve.glb', phase: 'download',
             loaded: 8388608, totalBytes: 41943040 } }
```

### assets.uploadBegin / assets.uploadChunk / assets.uploadAbort / assets.uploadFinish
The chunked-upload wire protocol behind large `assets.import` calls. Hosts
normally never send these directly — the SDK's `assetsImport` switches to them
automatically for a `Blob`/`File` ≥ 500 MB (streamed in 64 MB chunks so a
multi-GB file imports without one huge buffer) — but they are ordinary
commands, documented here so a non-SDK host can implement the same flow.
`uploadBegin` acquires the cross-tab import lock (held for the whole
begin..finish window — `busy` error if another import runs), stages an OPFS
temp file and returns the `uploadId`; each `uploadChunk` appends its bytes
(the transferable) sequentially; `uploadFinish` takes the same fields as
`assets.import` (minus `bytes`) and responds like `assets.import` when the
cook completes. `uploadAbort` discards a partial upload and releases the lock
(best-effort cleanup).

```js
payload:  { fileName: 'plant.rvm', size: 2147483648 }      // assets.uploadBegin
response: { uploadId: '9f4e…' }
payload:  { uploadId: '9f4e…', offset: 0, bytes }          // assets.uploadChunk (per 64 MB slice)
response: { received: 67108864 }                           // total bytes staged so far
payload:  { uploadId: '9f4e…', fileName: 'plant.rvm',      // assets.uploadFinish — assets.import
            format: 'rvm', store: 'project-x' }            //   fields, minus bytes
response: { entries: [{ id: '...', store: 'project-x', name: 'plant', kind: 'merged' }], replaced: 0 }
payload:  { uploadId: '9f4e…' }                            // assets.uploadAbort
response: {}
```

### stores.list
List the asset stores (projects). "main" always exists. Call this FIRST — the
`store` field on the asset commands below rejects an unknown name, so a host
must know the valid names before targeting one.

```js
payload:  {}
response: { stores: [{ name: 'main', description: '', count: 12 },
                     { name: 'project-x', description: 'Client X', count: 3 }] }
```

### stores.create
Create a store (project) with an optional description; the store is shared by
model assets AND SQL databases. The `name` is sanitised (slashes → `-`,
trimmed, capped at 60 chars). Idempotent — an existing name (or the built-in
'main') is NOT an error: `created` is false and the current store is returned,
so a host can call this to ensure a store exists before importing into it.

```js
payload:  { name: 'project-x', description: 'Client X' }
response: { created: true, store: { name: 'project-x', description: 'Client X', count: 0 } }
```

### assets.load / assets.unload
Load into / unload from the viewer by asset id. `store` (optional, must be a
known name) restricts loading to ids that belong to that store.

The camera follows one of three rules: `fit: true` (default) frames what was
loaded, `fit: false` leaves the camera untouched, and a `camera` object (same
fields as `camera.set`) places it explicitly — replacing the fit, so the view
never frames the models and then jumps somewhere else. With a `camera` the
move happens BEFORE the models load by default (`cameraFirst: true` — the
camera is awaited, so it has ARRIVED before the first model appears);
`cameraFirst: false` moves after the load instead, e.g. to animate onto
something that just arrived. Either way the command responds after the camera
has settled.

Models load in PARALLEL (`concurrent`, default the viewer's load-pool setting,
clamped to 16) with VRAM-budget residency swaps paused for the batch. While it
runs the viewer posts unsolicited `assets.load:progress` events —
`{ batchId, completed, total, index, id, phase }`, `phase` one of `done` /
`error` per model, `index` the model's slot in the `ids` you sent. Ticks
interleave, so key your UI on `index`. `progress: true` (the SDK sets it when
you pass `onProgress`) keeps the viewer's own loading overlay down; without it
the viewer shows the same overlay as a panel load.

```js
payload:  { ids: ['mdl8f2-k3j9x'], fit: true, store: 'project-x' }  // fit = frame the batch
response: { loaded: 1 }

payload:  { ids: ['mdl8f2-k3j9x'], camera: { position: [30, -15, 18], target: [12, 3, 1] } }
response: { loaded: 1 }                        // placed (camera first), not fitted

payload:  { ids: ['mdl8f2-k3j9x'], camera: { target: [12, 3, 1] }, cameraFirst: false }
response: { loaded: 1 }                        // load, THEN move

payload:  { ids: ['mdl8f2-k3j9x'], fit: false }   // load without moving the camera
response: { loaded: 1 }

// progress events while a batch loads (with progress: true, no viewer overlay)
{ tredespace: 1, id: null, type: 'assets.load:progress',
  payload: { batchId: 'ts-x1-load-2', completed: 2, total: 5, index: 1,
             id: 'mdl3aa-p0q2z', phase: 'done' } }
```

### assets.setLoaded
Declarative load state: after this call the loaded set is EXACTLY `ids` —
anything loaded but not listed is unloaded, anything listed but not yet loaded
is loaded, anything already right is untouched. Idempotent, so a sync can call
it every cycle with its desired set (typically the ids picked from
`assets.list`). An empty `ids` unloads everything. `store` (optional, must be
known) scopes BOTH directions — assets in other stores are never touched.
Unloads run before loads so VRAM frees first. `fit` is opt-in here (default
false — a background sync should not move the camera); when true it frames the
union of the whole desired set, not just what this call loaded. A `camera`
object (same fields as `camera.set`) places the view explicitly instead and
needs no opt-in — passing one IS the instruction to move; `cameraFirst`
(default true) orders it before the loads, as on `assets.load`. `concurrent`
and `progress` behave as on `assets.load`, and the `assets.load:progress` events
cover the models this call actually had to load. `missing`
lists requested ids that are not in the asset manager — import those first.

```js
payload:  { ids: ['mdl8f2-k3j9x', 'mdl3aa-p0q2z'], store: 'project-x', fit: false }
response: { loaded: 1, unloaded: 2, missing: [] }
```

### assets.remove
Delete persisted assets from local storage (OPFS) by id. A copy already loaded
into the viewer stays on screen — import → load → remove leaves a session-only
model with nothing on disk. `store` (optional, must be a known name).

```js
payload:  { ids: ['mdl8f2-k3j9x'], store: 'project-x' }
response: { removed: 1 }
```

### viewpoints.get
The whole viewpoint set as ONE opaque JSON blob — the exact shape the panel's
Save button writes to `viewpoints.json` ({ version, viewpoints }). Persist it
host-side (per user, per project…) and restore it later with `viewpoints.set`.
Viewpoints carry model-relative content (fullnames, positions, color rules),
so a blob belongs with the models it was made against.

```js
payload:  { }
response: { config: { version: 1, viewpoints: [ /* full viewpoint records */ ] } }
```

### viewpoints.set
REPLACE the current viewpoint set from a config blob — from `viewpoints.get`,
a `viewpoints.bookmark` event, or a saved viewpoints JSON file (same shape,
same tolerant parsing: missing fields get defaults, ids are regenerated). An
active viewpoint's scene mute is undone first, exactly like the panel's Load.
`showViewer: true` then docks the Viewpoint Viewer panel on the RIGHT (the
side column is recreated if pruned) and makes it active — load-and-present in
one call.

```js
payload:  { config: { version: 1, viewpoints: [ … ] }, showViewer: true }
response: { loaded: 3 }
```

### viewpoints.setUrl
Same as `viewpoints.set`, but the VIEWER downloads the config from a URL —
a hosted `viewpoints.json` (fetched under the viewer origin's CORS, like the
other *Url commands). `showViewer` works identically. Fails with a download
error when the fetch fails, `bad-payload` when the file isn't a viewpoints
config.

```js
payload:  { url: 'https://cdn.example.com/plant-7/viewpoints.json', showViewer: true }
response: { loaded: 3 }
```

### viewpoints.setBookmarkButton
Show (or remove, with `button: null`) a SESSION-ONLY bookmark button in the
Viewpoints panel, between Add viewpoint and Save. When the user clicks it the
viewer fires the unsolicited `viewpoints.bookmark` event (see Events) with the
CURRENT config attached — the host persists it wherever bookmarks live, no
follow-up `viewpoints.get` needed. Like host-set external apps, the button is
never persisted: a reload drops it until the host sets it again after
`app.ready`.

```js
payload:  { button: { label: 'Bookmark', tooltip: 'Save this view to the project' } }
response: { shown: true }

payload:  { button: null }        // remove the button
response: { shown: false }
```

### externalApps.set
Declaratively set the SESSION-ONLY host-managed external apps: replaces any
prior host-set entries with `apps` — user-configured Settings entries are
untouched, and `apps: []` clears the host set. Entries take the same fields as
Settings → External (`name` + `url` required; `section`, `size`, `tooltip`,
`multiple`, `newWindow`, `modal`, `openOnStart`, `config` optional — `config`
may be an object, stringified onto the page's `?config=` param). For a
`modal` app the config's `width` / `height` also set the dialog's initial
size (`"600px"`, `"60%"` of the viewport, or a bare number = px; both default
to `"70%"`, capped at 96vw × 96vh and still user-movable/resizable). They appear
in the External ribbon and their origins get postMessage API access for this
session. **Nothing is persisted**: a reload drops them until the host calls
this again after `app.ready`, so a viewer opened without its host simply has
none — this is how a hosting page configures an out-of-the-box viewer for its
context without touching the user's settings. `openOnStart: true` opens that
entry immediately (panels/modals only; new-window entries are never
auto-opened — window.open without a user gesture is popup-blocked).

```js
payload:  { apps: [
              { name: 'Projects', url: 'https://portal.example.com/picker',
                modal: true, openOnStart: true,
                // width/height size the dialog (default 70% × 70%)
                config: { width: '480px', height: '320px', project: 'plant-7' } },
              { name: 'Docs', url: 'https://portal.example.com/docs', section: 'Portal' },
              // home: the button sits on the HOME ribbon, not External;
              // homeAt picks which end of it ('start' default, or 'end')
              { name: 'Project', url: 'https://portal.example.com/projects',
                home: true, homeAt: 'start', section: 'Portal', modal: true } ] }
response: { apps: [ { id: 'm3k9x-a1b2', name: 'Projects', url: 'https://…/picker',
                      dialogId: 'm3k9x-a1b2:0' },   // modal opened by this call
                    { id: 'm3k9x-c3d4', name: 'Docs', url: 'https://…/docs' } ],
            opened: 1 }
```

### externalApps.list
Every configured external app — user-configured (Settings → External) and
host-set session entries alike, told apart by `hostManaged`.

```js
payload:  { }
response: { apps: [
  { id: 'k2j4…', name: 'Reports', url: 'https://…', section: '', size: 'medium',
    multiple: false, newWindow: false, modal: false, openOnStart: false,
    home: false, homeAt: 'start', hostManaged: false },
  { id: 'm3k9x-a1b2', name: 'Projects', url: 'https://…/picker', section: '',
    size: 'medium', multiple: false, newWindow: false, modal: true,
    openOnStart: true, home: true, homeAt: 'end', hostManaged: true } ] }
```

### sql.list
List the SQLite databases in OPFS (`sql_assets/<store>/<file>`). Stores are the
SAME registry as model assets (call `stores.list` first). `store` (optional,
must be a known name) lists just that store. Each db's `path` is what you pass
as `mainDb` to `sql.query`, and what an `ATTACH DATABASE '…'` literal refers to.
`md5` is the hash of the source bytes AS DELIVERED at import time (recorded
before WAL normalization, never updated by later in-app edits) — hash your
hosted file and compare to decide whether to re-import. It is absent for
databases imported before md5 recording existed or created in-app.

```js
payload:  { store: 'main' }   // or {} for all stores
response: { dbs: [
  { store: 'main', fileName: 'meta.db', path: 'sql_assets/main/meta.db',
    size: 61440, modified: 1721600000000, md5: '9e107d9d372bb6826bd81d3542a419d6',
    meta: { zipMd5: 'c3d4…' } },
] }
```

### sql.import
Write a `.db`/`.sqlite` file into a store. Bytes ride as a transferable (or a
Blob by reference). `store` (optional, default 'main', known name). `replace:
true` overwrites an existing same-name db; `false` (default) skips it. WAL
databases are normalised to rollback journalling on the way in — the OPFS VFS
is shm-less, so a WAL file could otherwise only be read in exclusive mode. A
same-name skip is a normal result, NOT an error. The md5 of the bytes as
delivered (hashed BEFORE the WAL normalization) is recorded and returned by
`sql.list`, as is any `meta` object you attach.

`progress: true` (the SDK sets it when you pass `onProgress`) emits
`sql.importUrl:progress` events and keeps the viewer's own dialogs down.

```js
iframe.contentWindow.postMessage({
  tredespace: 1, id: 'req-9', type: 'sql.import',
  payload: { fileName: 'meta.db', store: 'main', replace: true },
  bytes,                                    // ArrayBuffer, listed as transferable
}, origin, [bytes]);

response: { imported: ['sql_assets/main/meta.db'], skipped: [], replaced: 1 }
```

### sql.importUrl
Batch-import `.db`/`.sqlite` files the **viewer downloads by URL** — nothing
rides postMessage, and each download is STREAMED straight into OPFS (constant
memory), so multi-GB databases import without ever being held in RAM. URLs are
fetched under the **viewer** origin's CORS, not the host's. `fileName`
defaults to the URL's last path segment; `store` (default 'main', must be
known) and `replace` apply to every file — `replace: false` (default) skips an
existing name WITHOUT downloading it. Files run serially; a download or write
failure lands in `failed` and never aborts the rest. Each imported file's md5
(of the downloaded bytes, hashed before WAL normalization) is recorded and
returned by `sql.list`, along with any per-file `meta` you attach — hash your
hosted file and compare first to skip unchanged imports entirely.

With `progress: true` (the SDK sets it when you pass `onProgress`) the viewer
posts unsolicited `sql.importUrl:progress` events and drives no dialogs of its
own. Files import ONE AT A TIME, so the ticks give you both counters a UI
needs: `completed`/`total` for "fetching file X of Y", and `loaded`/`totalBytes`
for the download percentage of the file in flight (`totalBytes` is present when
the server sent a content-length). `phase` is `download` (repeats as bytes
arrive), `import` (writing into OPFS + WAL normalization), then `done` or
`error`. `batchId` is echoed so a host can correlate them.

```js
payload:  { files: [
              { url: 'https://cdn.example.com/meta.db' },
              { url: 'https://cdn.example.com/big.sqlite', fileName: 'tags.db',
                meta: { zipMd5: 'c3d4…' } } ],       // yours, returned by sql.list
            store: 'project-x', replace: true, progress: true }
response: { imported: ['sql_assets/project-x/meta.db'],
            skipped: ['tags.db'],          // locked by another tab (or existed, when replace is false)
            replaced: 1,
            failed: [] }                    // [{ url, error }] for download failures

// progress events while it runs
{ tredespace: 1, id: null, type: 'sql.importUrl:progress',
  payload: { batchId: 'ts-x1-sql-3', completed: 1, total: 2, index: 1,
             fileName: 'tags.db', url: 'https://…/big.sqlite',
             phase: 'download', loaded: 8388608, totalBytes: 41943040 } }
```

### sql.delete
Delete databases by their OPFS `path` (from `sql.list`). A path in use by a
running query or another tab is skipped, never waited on. Unknown paths are
ignored.

```js
payload:  { paths: ['sql_assets/main/meta.db'] }
response: { deleted: ['sql_assets/main/meta.db'], skipped: [] }
```

### sql.check
Pre-flight a SQL script WITHOUT running it: report every database it
references — the optional `mainDb` plus each `ATTACH DATABASE '…'` string
literal (an exact scan, comment- and literal-aware; same parser `sql.query`
locks with), in appearance order, deduped. Each entry says whether the file
exists; present entries carry `size`, `modified` and the import-time `md5`
(hash of the bytes as delivered — see `sql.list`), so a host can compare
against its manifest and `sql.importUrl` only the missing or outdated files
before calling `sql.query`.

```js
payload:  { sql: "ATTACH DATABASE 'sql_assets/main/tags.db' AS tags; SELECT …",
            mainDb: 'sql_assets/main/meta.db' }
response: { dbs: [
  { path: 'sql_assets/main/meta.db', exists: true,
    size: 61440, modified: 1721600000000, md5: '9e107d9d372bb6826bd81d3542a419d6' },
  { path: 'sql_assets/main/tags.db', exists: false } ] }
```

### sql.query
Run SQL against `mainDb` (a path from `sql.list`). Bring in other databases
with `ATTACH DATABASE 'sql_assets/<store>/<file>'` — those literals are scanned
and each file is Web-Locked alongside the main db before any handle opens.
`lockmode` defaults to `'shared'` (read-only, several readers at once); pass
`'exclusive'` to write. Rows per statement are capped at `maxRows` (default
10000); a truncated statement carries `truncated: true` and its full count in
`rowCount`. Results come back one entry per statement, in order; rows are
compact value arrays parallel to `columns`.

```js
payload:  { mainDb: 'sql_assets/main/meta.db',
            sql: "SELECT id, name FROM part LIMIT 2;",
            lockmode: 'shared', maxRows: 10000 }
response: { statements: [
  { columns: ['id', 'name'], rows: [[1, 'Flange'], [2, 'Bolt']], rowCount: 2 },
], ms: 4.1 }
```

### sql.execute
The full statement form — the same contract the viewer's SQL editor and the
original sqllitedebug tool run on. `statements` run against `mainDb` in ONE
transaction (with `lockmode: 'exclusive'`; `'shared'` is read-only), so a load
of several tables commits or rolls back as a unit. Per statement: `sql`,
optional `name` (echoed in the result and in progress), `binding` — one value
array per execution, several rows = the statement is prepared once and stepped
per row (bulk INSERT without a giant SQL string), `null` binds NULL — and
`collect` (keep the rows; default false, so writes return nothing). `attach`
lists extra database paths to Web-Lock alongside `mainDb`; any
`ATTACH DATABASE '…'` literal in a statement is locked automatically as well.
`maxRows` caps rows per collected statement like `sql.query`. A failing
statement rolls the whole batch back and the error carries sqlite's own
message (`no such table: x`, `datatype mismatch`, `UNIQUE constraint failed`),
so a host can act on it.

`progress: true` (the SDK sets it when you pass `onProgress`) emits
`sql.execute:progress` events: a `statement` tick as each statement FINISHES
(`no` = its index, `total` = statement count, `name` when given) and a `row`
tick every `progressSize` rows (default 1000) inside the current statement.

```js
payload:  { mainDb: 'sql_assets/main/meta.db', lockmode: 'exclusive',
            statements: [
              { name: 'schema', sql: 'CREATE TABLE IF NOT EXISTS tag(id INTEGER PRIMARY KEY, name TEXT)' },
              { name: 'load',   sql: 'INSERT INTO tag(id, name) VALUES (?, ?)',
                binding: [[1, 'P-101'], [2, 'V-204'], [3, null]] },   // stepped per row
              { name: 'count',  sql: 'SELECT count(*) AS n FROM tag', collect: true } ],
            progress: true, progressSize: 500 }
response: { statements: [
              { name: 'schema', columns: null, rows: [], rowCount: 0 },
              { name: 'load',   columns: null, rows: [], rowCount: 0 },
              { name: 'count',  columns: ['n'], rows: [[3]], rowCount: 1 } ],
            ms: 6.2 }

// progress events while it runs
{ tredespace: 1, id: null, type: 'sql.execute:progress',
  payload: { batchId: 'ts-x1-sqlexecuteprogress-4', type: 'statement', no: 1, total: 3, name: 'load' } }
{ tredespace: 1, id: null, type: 'sql.execute:progress',
  payload: { batchId: 'ts-x1-sqlexecuteprogress-4', type: 'row', no: 500, total: null } }
```

### ui.kiosk
Kiosk mode: viewport only — panels closed, ribbon collapsed. Made for iframe
hosting. Omit `on` to query the current state without changing it. Also
reachable as `?kiosk=1` at embed time and hotkey `view.kiosk` in the app.

```js
payload:  { on: true }        // or {} to just query
response: { kiosk: true }     // state after the call
```

### ui.theme
Set the viewer's colour theme, or omit `theme` to query the current one without
changing it. Lets an embedded viewer follow the host page's light/dark mode.

```js
payload:  { theme: 'light' }   // 'dark' | 'light'; or {} to just query
response: { theme: 'light' }   // theme after the call
```

### ui.close
Sent BY an embedded external app: close the modal dialog or dock panel that
hosts the sending window (e.g. a project selector closing itself after the
choice is made). Errors with `not-found` when the sender is not hosted in a
closable dialog/panel.

```js
payload:  {}
response: { closed: true }
```

### instance.set / instance.get
One shared in-memory JSON object per viewer window — external dialogs
coordinate through it (a project selector sets it; other dialogs read it or
listen for `instance.changed`). `merge: true` shallow-merges into the current
object instead of replacing it. Not persisted — it lives and dies with the
viewer window.

```js
payload:  { data: { project: 'P-42', role: 'review' }, merge: false }
response: { data: { project: 'P-42', role: 'review' } }   // state after the call
// instance.get: payload {} → same response shape
```

### labels.explode / labels.implode
Spread the scene labels apart (explode) or pull them back onto their anchors
(implode) — the in-app label-layout toggles.

```js
payload:  {}
response: {}
```

### colorRules.resetModel
Reset the model's per-item color/opacity overrides — the same thing the in-app
**Alt+R** does.

```js
payload:  {}
response: {}
```

### clip.box.get
The default clipping box. `enabled` is what the renderer honours — the global
clip switch AND the box itself on. `min`/`max` are world-space axis-aligned
bounds (exact for an unrotated box, the envelope of its corners otherwise);
`center`/`size`/`rotation` are the exact oriented box. Intersect `min`/`max`
with your own asset bounds to decide which models to load.

```js
payload:  { }
response: { enabled: true, inverted: false,
            min: [-5, -5, -5], max: [5, 5, 5],
            center: [0, 0, 0], size: [10, 10, 10], rotation: [0, 0, 0, 1] }
```

### clip.box.fitSelected
Fit the clipping box to the current selection. `offset` (optional, metres)
adds a margin on every side for THIS call only — it does not change the panel's
stored Fit-Sel offset.

```js
payload:  { offset: 2 }        // or {} for a tight fit
response: { offset: 2 }
```

### clip.shapes.add
Append clip shapes (sphere / cylinder / box). Only `kind` is required; the rest
default (center [0,0,0], radius 5, height 10, box halfExtents [1,1,1], identity
rotation, enabled, not inverted; `inverted: true` cuts a hole).

```js
payload:  { shapes: [ { kind: 'sphere', center: [0,0,0], radius: 5 } ] }
response: { added: 1 }
```

### clip.box.disable
Turn box clipping off (clip shapes stay in place).

```js
payload:  {}
response: {}
```

### clip.reset
Full clip reset — disable the box AND remove every clip shape.

```js
payload:  {}
response: {}
```

### camera.get
The camera's current placement, as orbit parameters AND as an eye `position`
(Z-up world). Round-trips: hand the result back to `camera.set` (or to a load
command's `camera`) to restore the exact view.

```js
payload:  { }
response: { target: [12.4, 3.1, 0.8], position: [30.2, -14.9, 18.6],
            azimuth: 0.61, elevation: 0.5, distance: 42.7, orthographic: false }
```

### camera.set
Move the camera. Give an eye `position` + `target`, or `target` +
`azimuth`/`elevation`/`distance` (radians / world units); anything omitted
keeps its current value, so `{ target: [x,y,z] }` re-pivots without turning.
`orthographic` switches projection, `animate: false` snaps instead of gliding.
Responds with the pose actually applied — and only once the camera has
ARRIVED (the glide is an animation; a chained command sees the final view).
An explicit placement also keeps the viewer's first-model default view from
overriding it.

```js
payload:  { position: [30, -15, 18], target: [12, 3, 1], animate: false }
response: { target: [12, 3, 1], azimuth: 0.61, elevation: 0.5, distance: 42.7 }
```

### nav.flyTo / nav.orbit
Drive the camera to a node by fullname. `flyTo` frames it; `orbit` re-pivots on
it (camera stays put). `select: true` also selects it — otherwise the selection
is left untouched. `wait: true` responds only once the camera has ARRIVED (the
move is an animation the render loop drives), so a chained `view.screenshot`
or `camera.get` sees the final view; without it the response comes back
immediately and the camera is still gliding. `matched` is false when the
fullname isn't found.

```js
payload:  { fullname: '/SITE/ZONE-1/PIPE-401', select: false, wait: true }
response: { matched: true }
```

### nav.fitVisible
Frame everything currently VISIBLE — every item that is not hidden, moved
geometry included — as tightly as the viewport allows (the same framing as
"fly to selection", applied to the visible set). Hiding or isolating first and
then calling this is the way to zoom onto an arbitrary set. `wait: true`
responds only once the camera has arrived. `fitted` is false when the model is
not up yet or every item with geometry is hidden.

```js
payload:  { wait: true }
response: { fitted: true }
```

### model.reset
Reset the model's overrides. Naming kinds resets ONLY those — `{ hidden: true }`
unhides everything and leaves the colors alone; an EMPTY payload resets all
four. Color, opacity and hidden share one undo step; transforms are their own
undo domain. The response echoes what was reset.

```js
payload:  { color: true, opacity: true, hidden: true, transform: false }
response: { color: true, opacity: true, hidden: true, transform: false }
```

### ui.dialogs
List the open EXTERNAL modal dialogs (external-app entries with "Modal
dialog"). Each `id` is what the `ui.dialog.*` commands address; a modal opened
by `externalApps.set` reports the same value as `dialogId`.

```js
payload:  { }
response: { dialogs: [
  { id: 'm3k9x-a1b2:0', appId: 'm3k9x-a1b2', name: 'Projects',
    url: 'https://…/picker', hidden: false } ] }
```

### ui.dialog.hide / ui.dialog.show
Hide a dialog WITHOUT closing it, or bring it back. The iframe stays MOUNTED
(`display:none`), so the page inside keeps running and keeps its state — a
half-filled form or a live session survives hide → show, unlike
`ui.dialog.close`, which unmounts it and loses the context. Park a dialog
while a model loads, then either show it again or close it; showing also
raises it above the other dialogs. `id` is optional for a request coming FROM
an embedded app — it then addresses the dialog hosting the sender.

```js
payload:  { id: 'm3k9x-a1b2:0' }
response: { id: 'm3k9x-a1b2:0', hidden: true }
```

### ui.dialog.close
Close one external modal dialog by id (its page is unmounted, context lost).
`id` is optional from inside an embedded app — same self-close as `ui.close`.

```js
payload:  { id: 'm3k9x-a1b2:0' }
response: { id: 'm3k9x-a1b2:0', closed: true }
```

### ui.showPanel / ui.hidePanel
Open / close a dock panel by id (e.g. `hierarchy`). Errors `not-found` for an
unknown panel id.

```js
payload:  { panel: 'hierarchy' }
response: { shown: true }        // hidePanel → { hidden: true }
```

### ui.loading.show / ui.loading.hide
Show / hide the blocking loading overlay. `header` is the bold title line,
`title` the message below it (both optional).

```js
payload:  { header: 'Please wait', title: 'Loading project…' }   // hide: {}
response: {}
```

### ui.confirm
Show a confirm dialog and resolve with the user's choice.

```js
payload:  { question: 'Discard changes?', header: 'Confirm', yes: 'Discard', no: 'Keep' }
response: { confirmed: true }
```

### ui.error
Show an error dialog. `title` is the message, `header` the bold title (optional).

```js
payload:  { title: 'Import failed — see console.', header: 'Error' }
response: {}
```

## Transports

The envelope/commands above are TRANSPORT-AGNOSTIC — correlation ids do the
routing regardless of carrier. The app-side dispatcher should be written
against a tiny transport interface (`{ onMessage, send }`) so carriers can be
added without touching command handling. SDK request ids carry a random
per-instance prefix, so multiple clients on one shared carrier never collide.

- **postMessage (v1, this document).** iframe / `window.open`, any origin.
  Addressing is the window reference itself; origin allowlist as described;
  zero-copy `ArrayBuffer` transferables.
- **BroadcastChannel (planned, cheap).** For a viewer in a SEPARATE TAB.
  Same-origin only — host and viewer must be served from one origin (a
  portal on another domain cannot use this). Note this is stricter than
  same-origin alone: a page of the host's embedded INSIDE a cross-domain
  viewer is storage-PARTITIONED away from the host's own top-level page (it
  has a cross-site ancestor), so BroadcastChannel/localStorage/IndexedDB do
  not reach between them either — see "Host frames and storage partitioning"
  below. Pairing: the host mints a
  channel name `tredespace-<uuid>` and opens the viewer with
  `?apiChannel=tredespace-<uuid>`; both sides simply join that channel — the
  unguessable name doubles as the capability token, and no extra instance-id
  handshake is needed. No transferables (bytes are structured-clone copied
  once). `app.ready` is re-broadcast on the channel when the app joins.
  Estimated ~50 lines per side once the transport interface exists.
- **WebSocket (future, real scope — defer until a concrete backend case).**
  The viewer is a static client app: it can only connect OUT, so a host-run
  relay server is required. Config via `?apiWs=wss://…&apiToken=…`. Brings
  its own auth story (tokens at the relay), reconnect/heartbeat handling,
  and a binary framing decision for file bytes (JSON header frame + binary
  frame pair, or length-prefixed) — none of which the in-page transports
  need. Enables genuinely new scenarios (backend-driven review sessions,
  cross-machine control) — design it when one is actually wanted.

## Events (app → host, unsolicited)

Beyond request/response, the app emits unsolicited events: same envelope with
`id: null` (like `app.ready`). They are posted to the parent window, the
opener, AND every embedded iframe on an allowed origin (external-app panels /
dialogs) — so hosts work whether they host the viewer or are hosted by it.
SDK: `client.on(type, handler)` or the typed helpers; handlers get the payload.

### tree.select
The user selected a node — a row in the tree view (Hierarchy panel or its
search results) or an item picked by clicking the model in the viewport
(including ctrl+click toggles and digit+click level selects), or the
selection walked up / down the hierarchy with the U / P keys. The payload
carries the fullname plus every parent up to the root —
import folders first (`type: 'folder'`, each with its cumulative `path`), then
model hierarchy ancestors (`type: 'node'`) — enough for a host to mirror the
selection, look up its own metadata, or navigate.

```js
// item row
{ tredespace: 1, id: null, type: 'tree.select', ok: true, payload: {
    fullname: '/SITE/ZONE-1/PIPE-401',
    name: '/SITE/ZONE-1/PIPE-401',
    folder: false,                      // true when the node has children
    group: 'plant/area52',              // the import folder it lives in
    parents: [
      { name: 'plant',  type: 'folder', path: 'plant' },
      { name: 'area52', type: 'folder', path: 'plant/area52' },
      { name: '/SITE',        type: 'node' },
      { name: '/SITE/ZONE-1', type: 'node' },
    ],
} }
// folder row: fullname is the folder path, folder: true, parents = ancestor folders
```

SDK: `client.onTreeSelect((e) => …)` — returns an unsubscribe function.

### instance.changed
Fired after any host calls `instance.set` — every connected host (including
the setter) receives the full new object, so dialogs can adapt their behavior
to e.g. the selected project.

```js
{ tredespace: 1, id: null, type: 'instance.changed', ok: true,
  payload: { data: { project: 'P-42' } } }
```

SDK: `client.onInstanceChanged((e) => …)`.

### theme.changed
The viewer's theme switched — from ANY route: the Settings tab, the theme
hotkey, a `ui.theme` command, or another tab/window syncing its settings over.
Hosts and embedded apps use it to restyle in step with the viewer. SDK:
`onThemeChanged(handler)`.

```js
{ tredespace: 1, id: null, type: 'theme.changed',
  payload: { theme: 'dark' } }              // 'dark' | 'light'
```

### viewpoints.bookmark
The user clicked the host-configured bookmark button in the Viewpoints panel
(`viewpoints.setBookmarkButton`). The payload carries the button's `label`
and the CURRENT viewpoints config blob — persist it host-side; hand it back
via `viewpoints.set` to restore. SDK: `onViewpointsBookmark(handler)`.

```js
{ tredespace: 1, id: null, type: 'viewpoints.bookmark',
  payload: { label: 'Bookmark',
             config: { version: 1, viewpoints: [ … ] } } }
```

## External app hosting (Settings → External)

Each configured app has: section/size/tooltip for its ribbon button, **Show in
Home** (the button sits on the HOME ribbon instead of External — for a tool the
user should see right away, like a project selector; it appears in one place,
not both) with a placement picker for which END of the Home ribbon its group
sits at (before the viewer's own groups, or after them), **Multiple instances**, **New window** (browser tab instead of a
panel),
**Modal dialog** (centered overlay, movable by its title bar and resizable
from the bottom-right handle; the viewer's own loading/error/confirm dialogs
always layer above it), **Open on start** (e.g. a project selector), and a
**config JSON** field passed to the page as a stringified `?config=` URL
parameter. Multi-instance panels left open in the layout are restored on
reload as long as their app entry still exists.

A hosting page can additionally supply SESSION-ONLY entries through
`externalApps.set` — same fields, shown in the ribbon alongside the user's,
but never persisted and not editable in Settings (the tab notes how many are
host-set). The intended flow: embed the viewer → wait for `app.ready` → set
the apps for the current context.

The config JSON doubles as the modal's initial-size source — `width` and
`height` accept px or % of the viewport (`{"width": "600px", "height": "60%"}`;
a bare number means px), defaulting to 70% × 70%. The rest of the object is
still delivered verbatim to the page.

## Host frames and storage partitioning

A host page often ends up embedding the viewer, with the viewer embedding a
page of the HOST's back as an External-app panel or modal dialog. Those two
host pages are same-origin, but the browser puts them in **different storage
partitions**: the nested one has a cross-site ancestor (the viewer), so
`BroadcastChannel`, `localStorage` and IndexedDB do not reach between them.

Measured in Chrome 151 (A = the host's site, B = the viewer's site):

| chain | BroadcastChannel |
| --- | --- |
| A → A (no viewer in between) | works |
| A → viewer(B) → A | nothing arrives |
| A → viewer(B) → A, with the viewer's iframe `sandbox` attribute | nothing arrives |
| two A pages side by side inside viewer(B) | works |
| A → viewer(B) → A, Chrome `--disable-features=ThirdPartyStoragePartitioning` | works |

The sandbox attribute is not the cause (the viewer's external iframes carry
`allow-same-origin`, and adding or removing it changes nothing), and the
partitioning is not a permission the viewer can grant. The flag in the last
row is a browser-wide privacy setting — evidence of the cause, not a
deployment option.

What to do instead:

- **Between two of the host's pages inside the viewer** (two dialogs, or a
  dialog and a panel): they share one partition, so `BroadcastChannel` works
  between them directly.
- **Nested page ↔ the host's top page**: `postMessage` is unaffected by
  partitioning — the nested page's `window.parent.parent` is the top page
  (validate `event.origin` on both ends). Or relay through the viewer with
  `instance.set` / the `instance.changed` event, which is one shared JSON blob
  per viewer window delivered to every embedded frame.
- **Serve the viewer from the host's own site** (a path, or a subdomain — a
  subdomain is same-*site*): no cross-site ancestor, so every same-origin
  mechanism works normally.

## Hosting: reverse-proxy the viewer under your own site

The partitioning above is one symptom of a general rule: when the viewer is a
**cross-site** frame, everything the host opens *inside* it (External-app
panels, modal dialogs, popups) runs with a cross-site ancestor and inherits
third-party restrictions — partitioned storage, third-party cookie rules,
`BroadcastChannel` silence, stricter permission delegation. Sub panels that
work on your site standalone can then fail to open or lose their session.

The fix is to make the viewer **same-site**: serve it through your own
reverse proxy (a path, or a subdomain of your site) instead of framing
`tredespace.com` directly. Then your pages inside the viewer are first-party
again, `?apiOrigins=` is unnecessary (same-origin needs no allow-list), and
cookies/SSO on your domain reach your embedded panels. nginx example:

```nginx
location /tredespace/ {
    proxy_pass https://tredespace.com/;
    proxy_set_header Host tredespace.com;
    proxy_ssl_server_name on;
    proxy_ssl_name tredespace.com;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header "requested-by" "proxy";
}
```

and embed `https://your-site.example.com/tredespace/`. The build uses relative asset paths, so a sub-path like `/tredespace/` works as-is.

**Internal networks — this is not optional.** `tredespace.com` is a public
site. If your host application lives on an internal network, framing the
public viewer directly means every user's browser must reach the internet
for the viewer itself, and — worse — your internal panels then open *inside
a public-origin frame*: an internal app's `frame-ancestors` / `X-Frame-Options`
policy (rightly) refuses a public ancestor, its SSO cookies are scoped to the
internal domain and never arrive, and its API calls come from a third-party
context. Behind your proxy the viewer *is* an internal URL: the browser only
ever talks to your server (the server fetches `tredespace.com`, and can be the
one machine with outbound access), your frame-ancestor rules keep allowing
only your own domain, and the whole thing works on a network with no public
egress for clients. Model data was never at stake either way — the viewer
keeps files in the browser (OPFS) and uploads nothing — but the *application*
delivery and the security context of your panels are, and the proxy fixes
both.

**Development (host app on `localhost`).** The same applies while you
develop: a host page on `http://localhost:2080` that frames the public viewer,
which then opens *your* localhost panels/dialogs, asks a public origin to load
a **local** resource — Chrome and Edge block that (Private Network Access:
"public website → private/local network"), and the panel simply never opens.
Two ways out:

- **Proxy in dev too** — your dev server forwards a path to the viewer, so the
  viewer is `localhost` as well. Vite:

  ```js
  // vite.config.js of the HOST app
  server: {
    proxy: {
      '/tredespace': {
        target: 'https://tredespace.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tredespace/, ''),
      },
    },
  },
  ```

  and embed `http://localhost:2080/tredespace/`.
- **Or relax the browser** for your own machine only: in `chrome://flags` /
  `edge://flags` search "private network" and disable the block on insecure
  private-network requests (the exact flag name moves between versions).
  That is a per-developer setting, never something to ask users to do.

**Versions.** A proxy always serves whatever `tredespace.com` currently ships
— you get every update, and every change. If you need to **lock a version**
(validation, regulated environments, a release train of your own), host the
viewer yourself: run your own container of a chosen build, or fork the
project — the proxy pattern is for staying current, not for pinning.

## Future (documented, not v1)

- `viewpoints.list` / `viewpoints.activate` — drive presentations from the host.
- `export.glb` / `export.ifc` — return the exported bytes to the host
  instead of downloading.
- More events (`selection.changed`, `model.loaded`) — `tree.select` sets the
  pattern; a `subscribe` command is still not required (events are cheap and
  hosts just ignore types they don't listen for).

## Implementation notes

- One `window.addEventListener('message')` in `messageApi.ts` (installed from
  `App.tsx`): origin check → envelope check → per-command payload validation
  → call the existing action → post result. Async commands hold the same
  Web-Locks import lock the UI uses.
- `app.ready` fires after renderer init + `assetsActions.init()`.
- Responses go to `event.source` (works for iframe parent AND `window.open`
  openers), `targetOrigin` = `event.origin`.
- Size guard on `assets.import` (reject > ~2 GB, matching the buffer limits).
- The command surface reuses ONLY exported actions — no new state paths, so
  UI and API can never drift apart.
