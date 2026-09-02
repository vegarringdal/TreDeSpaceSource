// tredespace-client.ts — typed postMessage client for the TreDeSpace viewer.
//
// SPDX-License-Identifier: MIT
//
// Copyright (c) 2026 Vegar Ringdal
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// COPY THIS FILE into your host application (it is dependency-free and
// self-contained). It implements the protocol described in EVENTS.md of the
// viewer repository, protocol version 1. Keep the two in sync when updating.
//
// STRICT (enforced by the build): every command method needs a JSDoc comment
// AND a matching `### command` section with a fenced payload/response example in
// EVENTS.md — the /docs/ reference is generated from both. `vite build` fails if
// either is missing. See CLAUDE.md → "postMessage API".
//
// Commands NEVER throw — they resolve a Result<T> = { data?, error? }; check
// `error` (Rust-style). Only ready()/on*()/dispose() sit outside that.
//
// GETTING ACCESS (the viewer ignores messages from unknown origins):
//   The easiest bootstrap is the embed URL — your page controls it, and the
//   viewer honors ?apiOrigins= by default:
//     <iframe src="https://viewer.example.com/?apiOrigins=https://your-portal.example.com">
//   Alternatives: same-origin hosting needs nothing; or an admin lists your
//   origin under the viewer's Settings → External → API security (required if
//   a deployment turned the URL-parameter route off there).
//
// Usage — your page EMBEDS the viewer in an iframe:
//   const client = new TredespaceClient(iframe, { targetOrigin: 'https://viewer.example.com' });
//   await client.ready();                          // resolves on app.ready
//   const res = await client.selectionSet(['/TP400-PIPE-01']);
//   if (res.error) console.warn(res.error.msg);
//   else console.log(res.data.matched, res.data.missed);
//   client.dispose();
// Usage — your page runs INSIDE the viewer (External-app panel/dialog): same,
// but drive the parent window, with the VIEWER's origin as targetOrigin
// (derivable from document.referrer; never '*' — it is also the filter for
// which incoming messages this client trusts):
//   const viewerOrigin = new URL(document.referrer).origin;
//   const client = new TredespaceClient(window.parent, { targetOrigin: viewerOrigin });
//
// TALKING BETWEEN YOUR OWN FRAMES (browser storage partitioning):
//   When your page embeds the viewer and the viewer embeds a page of YOURS
//   back (an External-app panel or modal dialog), those two same-origin pages
//   of yours sit in DIFFERENT storage partitions: the nested one has a
//   cross-site ancestor (the viewer), so BroadcastChannel — and localStorage /
//   IndexedDB — do NOT reach between them. Measured, Chrome 151:
//     A → A                      (no viewer in between)     works
//     A → viewer(B) → A                                     nothing arrives
//     A → viewer(B) → A   (any iframe sandbox attribute)    nothing arrives
//     A | A side by side inside viewer(B)  (two dialogs)    works
//   It is not a sandbox or a permission the viewer controls — the one switch
//   that lifts it is Chrome's browser-wide
//   `--disable-features=ThirdPartyStoragePartitioning`, a global privacy
//   setting and never something to build a product on. Use instead:
//     - between two of YOUR pages inside the viewer: BroadcastChannel works
//       (same partition) — no relay needed.
//     - nested page ↔ your top page: postMessage directly (the nested page's
//       window.parent.parent is your top page; validate event.origin), or
//       relay through the viewer with instanceSet / onInstanceChanged — one
//       shared JSON blob per viewer window, broadcast to every embedded frame.
//     - serving the viewer from your own site (a path or a subdomain — a
//       subdomain is same-SITE) removes the cross-site ancestor entirely, and
//       all of the above just works.
//
// HOSTING — proxy the viewer under your own site (recommended):
//   Framing tredespace.com directly makes the viewer a cross-site frame, so
//   the panels/dialogs of YOURS that open inside it are third-party: storage
//   partitioned, cookies/SSO not reaching them, BroadcastChannel silent. Put
//   the viewer behind your reverse proxy (a path or a subdomain) and embed
//   THAT — same-site, no ?apiOrigins= needed, your embedded panels keep their
//   session. nginx: `location /tredespace/ { proxy_pass https://tredespace.com/;
//   proxy_set_header Host tredespace.com; proxy_ssl_server_name on;
//   proxy_ssl_name tredespace.com; }` (full snippet in EVENTS.md → Hosting).
//   On an INTERNAL network this is not optional: tredespace.com is public, so
//   framed directly your internal panels would open inside a public-origin
//   frame (frame-ancestors refuses it, SSO cookies never arrive) and every
//   client needs internet access; proxied, the viewer is an internal URL and
//   only your server fetches tredespace.com.
//   In DEV the same bites: a host on http://localhost framing the public
//   viewer, which then opens your localhost panels = public → local request,
//   blocked by Chrome/Edge (Private Network Access). Proxy in dev too (Vite
//   server.proxy '/tredespace' → https://tredespace.com, changeOrigin) or, on
//   your own machine only, disable the "private network" block in
//   chrome://flags / edge://flags.
//   A proxy always serves the CURRENT release; to lock a version, host your
//   own container of a chosen build or fork the project.
//
// EVENTS (unsolicited app → host; subscribe with on() or the typed helpers).
//   Every subscription returns its UNSUBSCRIBE function, and also takes
//   { signal } like addEventListener. The subscription signal and the client's
//   own constructor { signal } are INDEPENDENT: a global, app-lifetime client
//   takes no signal (so no component can dispose it by accident), and each
//   component owns just its subscriptions with its own AbortController. Keep
//   the handler in a ref so a closure over changing state doesn't
//   re-subscribe every render:
//     export const client = new TredespaceClient(iframe, { targetOrigin }); // global
//     …
//     const latest = useRef(handler); latest.current = handler;
//     useEffect(() => {
//       const ac = new AbortController();
//       client.onTreeSelect((e) => latest.current(e), { signal: ac.signal });
//       client.onThemeChanged((e) => setTheme(e.theme), { signal: ac.signal });
//       return () => ac.abort();   // ends these subscriptions; the client lives on
//     }, []);
//   Pass { signal } to the CONSTRUCTOR only when the client should die with a
//   scope (a modal that embeds its own viewer): abort() then disposes it too.
//   dispose() drops the message listener wholesale — nothing fires after it.
//   'tree.select'                — user selected a tree row / clicked the model
//   'instance.changed'           — the shared instance-data blob changed
//   'viewpoints.bookmark'        — user clicked the host bookmark button
//                                  (onViewpointsBookmark; config attached)
//   'theme.changed'              — viewer theme switched, from any route
//                                  (onThemeChanged) — restyle your frames
//   'assets.importUrl:progress'  — per-file import progress (assetsImportUrl
//                                  surfaces it via its onProgress option)
//   'assets.load:progress'       — per-model load progress (assetsLoad /
//                                  assetsSetLoaded, same onProgress option)
//   'sql.importUrl:progress'     — per-file + per-chunk SQL import progress
//                                  (sqlImport / sqlImportUrl onProgress)
//   'sql.execute:progress'       — per-statement + per-N-rows batch progress
//                                  (sqlExecute onProgress)
//   'sql.color:progress'         — rows collected so far while a colouring
//   'sql.select:progress'          query runs (sqlColor / sqlSelect
//                                  onProgress)
//
// COMMON FLOWS (each step is one method below — see its JSDoc):
//   Sync hosted models:   assetsList → compare each asset's md5 against a hash
//     of your hosted file → assetsImportUrl the changed/missing (replace:true),
//     assetsRemove the stale → assetsSetLoaded(desiredIds) applies the exact
//     visible set (idempotent; unlisted models are unloaded).
//   Colour from data:     sqlColor / sqlSelect run the query INSIDE the viewer
//     and hand the packed fullnames straight to the model DB — nothing but a
//     row count comes back, so million-row results are one message. For a list
//     your own backend produced, encodeNameList() + colorApplyList /
//     selectionSetList take the same packed path.
//   Sync hosted SQL dbs:  sqlList (md5 = hash of the bytes you delivered) →
//     sqlImportUrl only what changed (GB-safe: streamed straight into OPFS).
//     Or per query: sqlCheck(sql) pre-flights which dbs the script references
//     and whether they're present/current — then sqlQuery.
//   Viewpoint bookmarks:  viewpointsSetBookmarkButton({label}) → user clicks →
//     onViewpointsBookmark fires with the config blob → persist it; restore
//     later with viewpointsSet(config) or a hosted file via viewpointsSetUrl
//     (showViewer:true docks the presentation panel).
//   Context-dependent UI: externalAppsSet([...]) after ready() installs
//     SESSION-ONLY entries in the viewer's External ribbon (never persisted —
//     re-set them after every app.ready).

// ── protocol types ───────────────────────────────────────────────────────────

export const TREDESPACE_PROTOCOL = 1;

/** Failure codes: the five protocol codes the viewer can return, plus two
 *  host-side ones — a request that timed out, or a dead transport (disposed
 *  client / no viewer window). */
export type TredespaceErrorCode =
  | 'bad-payload'
  | 'not-ready'
  | 'busy'
  | 'not-found'
  | 'internal'
  | 'timeout'
  | 'transport';

/** Failure detail on a {@link Result}. `msg` is a human-readable string safe to
 *  show a user; `err` is the underlying detail when there is one (the raw wire
 *  error, or a caught exception). */
export interface TredespaceError {
  code: TredespaceErrorCode;
  msg: string;
  err?: unknown;
}

/** Rust-style result — exactly one of `data` / `error` is present. Command
 *  methods resolve this and NEVER throw; check `error` (or `data`).
 *
 *  ```ts
 *  const res = await client.selectionSet(['/SITE/PIPE-01']);
 *  if (res.error) console.warn(res.error.msg);
 *  else console.log(res.data.matched);
 *  ``` */
export interface Result<T> {
  data?: T;
  error?: TredespaceError;
}

export interface AppReady {
  version: string;
  api: number;
}

export interface SelectionSetResult {
  matched: number;
  missed: string[];
}

export interface SelectionGetResult {
  /** selected items (children included) */
  count: number;
  /** selection ROOTS as fullnames — what was clicked / set; a tree root
   *  stands for its whole subtree. Empty after invert or a viewport
   *  rectangle select, which have no roots — use `items` for those. */
  fullnames: string[];
  /** with { items: true }: every selected NODE's fullname — the leaves and
   *  the grouping entries above them (every row the tree highlights, not
   *  just the roots) — because the real tag is often on a parent row and
   *  which level varies per model; minus `skip` prefixes, capped at
   *  maxItems (default 10 000) */
  items?: string[];
  /** with { items: true }: the true number of selected nodes (after skip) */
  itemCount?: number;
  /** with { items: true }: `items` was cut at maxItems */
  truncated?: boolean;
}

export interface SelectionGetOptions {
  /** also return every selected node's fullname (grouping entries and
   *  leaves, children included) */
  items?: boolean;
  /** drop nodes whose name STARTS WITH any of these (case-insensitive; a
   *  trailing `*` is accepted): `['FRAME', 'BRACKET*']` */
  skip?: string[];
  /** cap for `items` (default 10 000) — a whole-model selection can be
   *  hundreds of thousands of names */
  maxItems?: number;
}

export interface LabelInput {
  /** shown text — supports **bold** and newlines in rich mode */
  text: string;
  /** anchor to a model item by fullname (bounds centre)… */
  fullname?: string;
  /** …or at an explicit world-space point */
  anchor?: [number, number, number];
}

export interface LabelsResult {
  added: number;
  /** fullnames that resolved to nothing */
  missed: string[];
}

export interface MeasurePointInput {
  pos: [number, number, number];
}

export interface MeasurementInput {
  kind: 'point' | 'line' | 'path' | 'area' | 'diameter' | 'angle';
  points: MeasurePointInput[];
  label?: string;
}

export interface FilterRowInput {
  op: 'append' | 'remove';
  /** contains | single (equals, * at start/end) | starts | ends |
   *  wildcard (equals, * anywhere) | multi (one name per line — a line may
   *  carry its own colour after a TAB/space/comma: `name<TAB>#ff0000:50`,
   *  colour[:opacity 0-100], `default` = original colour) */
  mode: 'contains' | 'single' | 'multi' | 'starts' | 'ends' | 'wildcard';
  value: string;
  comment?: string;
  /** Hierarchy level (1-9) the filter is applied TO, counted like the tree
   *  panel (import folders included): the row matches only the names at that
   *  level and each match includes its whole subtree. Level 1 tests the
   *  import-folder name (a hit takes everything under the folder).
   *  0/omitted = match at any level. */
  level?: number;
}

export interface ColorRuleInput {
  comment?: string;
  enabled?: boolean;
  filters: FilterRowInput[];
  /** hex color, or null = restore default */
  color: string | null;
  /** 0-1, 1 = default */
  opacity?: number;
  /** Scope the rule to the models loaded from this store (a known store
   *  name); omitted/'' = every store. Keeps a rule set safe when stores hold
   *  same-named models. An unknown name is rejected (not-found). */
  store?: string;
}

/** A clip shape to append (sphere / cylinder / box). Only `kind` is required;
 *  the rest default (center [0,0,0], radius 5, height 10, box halfExtents
 *  [1,1,1], identity rotation, enabled, not inverted). */
export interface ClipShapeInput {
  kind: 'sphere' | 'cylinder' | 'box';
  label?: string;
  center?: [number, number, number];
  axis?: [number, number, number];
  radius?: number;
  height?: number;
  halfExtents?: [number, number, number];
  rotation?: [number, number, number, number];
  enabled?: boolean;
  /** clip INSIDE the shape (a hole) instead of outside */
  inverted?: boolean;
  showHelper?: boolean;
}

/** The default clipping box, from {@link TredespaceClient.clipBoxGet}. */
export interface ClipBoxState {
  /** true when the box is actually cutting: global clipping on AND the box itself on */
  enabled: boolean;
  /** cut INSIDE the box (a hole) instead of outside */
  inverted: boolean;
  /** world-space axis-aligned bounds — exact for an unrotated box, the
   *  envelope of its 8 corners otherwise */
  min: [number, number, number];
  max: [number, number, number];
  /** the exact oriented box */
  center: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number, number];
}

export interface ColorRulesResult {
  rules: number;
  ran: boolean;
  matches: number[];
}

export interface ModelResetOptions {
  /** drop every color override */
  color?: boolean;
  /** drop every opacity override */
  opacity?: boolean;
  /** unhide every hidden item */
  hidden?: boolean;
  /** put every moved item back on its cooked placement */
  transform?: boolean;
}

/** Which kinds `model.reset` actually reset (an empty request resets all). */
export interface ModelResetResult {
  color: boolean;
  opacity: boolean;
  hidden: boolean;
  transform: boolean;
}

export interface SettingsGetResult {
  version: string;
  /** the persisted viewer-settings snapshot (read-only) */
  viewer: Record<string, unknown>;
}

export interface AssetInfo {
  id: string;
  /** whatever `meta` the import attached — your own bookkeeping, returned
   *  verbatim (e.g. the md5 of the COMPRESSED artifact you serve) */
  meta?: Record<string, unknown>;
  /** the store this asset belongs to (default 'main') */
  store: string;
  name: string;
  folder: string;
  fileName: string;
  /** MD5 of the source bytes — compare to decide whether to re-import */
  md5?: string;
  size: number;
  kind?: 'merged' | 'standard';
  hasNormals?: boolean;
  edges?: boolean;
  loaded: boolean;
}

/** A store = a named group of assets (a project). 'main' always exists. */
export interface StoreInfo {
  name: string;
  description: string;
  /** everything the store holds: `modelCount + sqlCount` */
  count: number;
  /** model assets in the store */
  modelCount: number;
  /** SQL databases in the store */
  sqlCount: number;
}

/** Conversion pipeline for an imported file. `tdp` is an already-cooked
 *  TreDeSpace file (e.g. a viewer export or a server-hosted model): it is
 *  stored as-is — no conversion — with its coarse (VRAM-budget) variant
 *  rebuilt in-app and its recorded md5 being the hash of the `.tdp` bytes
 *  themselves. */
export type ImportFormat = 'glb-merged' | 'glb-standard' | 'rvm' | 'ifc' | 'step' | 'tdp';

export interface AssetsImportResult {
  entries: AssetInfo[];
  /** how many prior assets were removed by `replace` (0 unless replace was set) */
  replaced: number;
}

/** One file for {@link TredespaceClient.assetsImportUrl}: a URL the VIEWER
 *  downloads itself, plus the pipeline to cook it with. `format` is required
 *  (a `.glb` URL is ambiguous — merged vs standard — so no format is inferred
 *  on the wire; infer it host-side from the extension if you like). */
export interface ImportUrlFile {
  /** URL the viewer fetches (subject to the VIEWER origin's CORS, not yours). */
  url: string;
  format: ImportFormat;
  /** metadata to store with the produced asset(s) and read back from
   *  `assetsList` — a converter that yields several assets tags them all */
  meta?: Record<string, unknown>;
  /** name to store the asset under; defaults to the URL's last path segment. */
  fileName?: string;
  folder?: string;
  /** per-format options, e.g. `{ normals: true, edges: true }` for glb-standard. */
  options?: Record<string, unknown>;
}

/** Per-file outcome within an {@link AssetsImportUrlResult}. Exactly one batch
 *  entry per input file, in input order; a failure here never aborts the rest. */
export interface AssetsImportUrlEntry {
  url: string;
  ok: boolean;
  /** assets produced (present when `ok`). */
  entries?: AssetInfo[];
  /** prior assets removed by `replace` for this file (present when `ok`). */
  replaced?: number;
  /** why this file failed (present when not `ok`) — download or convert error. */
  error?: string;
}

export interface AssetsImportUrlResult {
  /** number of files that imported successfully. */
  imported: number;
  /** number of files that failed (download or convert). */
  failed: number;
  results: AssetsImportUrlEntry[];
}

/** Progress tick for {@link TredespaceClient.assetsImportUrl} — one per phase
 *  change. `completed`/`total` count whole files; `phase` is what just started
 *  (`download`/`convert`) or ended (`done`/`error`) for `url`. */
/** Progress tick for one file in an {@link TredespaceClient.assetsImportUrl}
 *  batch. Files run in parallel, so ticks for several `index`es interleave —
 *  key your UI on `index` (its position in the `files` array you passed), not
 *  on arrival order. `completed`/`total` count whole files across the batch. */
export interface ImportUrlProgress {
  completed: number;
  total: number;
  /** index into the `files` array this tick belongs to */
  index: number;
  url: string;
  /** `download` repeats as bytes arrive; `convert` once the cook starts;
   *  `done` / `error` end that file. */
  phase: 'download' | 'convert' | 'done' | 'error';
  /** bytes downloaded so far (download phase only) */
  loaded?: number;
  /** total bytes, when the server sent a content-length (download phase only) */
  totalBytes?: number;
}

/** One SQLite database in OPFS (`sql_assets/<store>/<file>`). Stores are shared
 *  with model assets. `path` is what you pass as `mainDb` to `sqlQuery`, and
 *  what an ATTACH string literal references. */
export interface SqlDbInfo {
  store: string;
  /** whatever `meta` the import attached, returned verbatim */
  meta?: Record<string, unknown>;
  fileName: string;
  path: string;
  size: number;
  modified: number;
  /** MD5 of the source bytes AS DELIVERED at import time — compare against a
   *  hash of the hosted file to decide whether to re-import. Recorded before
   *  the WAL normalization rewrites the stored file and never updated by
   *  later in-app edits. Absent for databases imported before this existed or
   *  created in-app. */
  md5?: string;
}

export interface SqlImportResult {
  /** OPFS paths of the databases written. */
  imported: string[];
  /** file names skipped — already existed without `replace`, or the file was locked. */
  skipped: string[];
  /** how many existing databases were overwritten. */
  replaced: number;
}

/** One file for {@link TredespaceClient.sqlImportUrl}: a URL the VIEWER
 *  downloads itself, streamed straight into OPFS. */
export interface SqlImportUrlFile {
  /** URL the viewer fetches (subject to the VIEWER origin's CORS, not yours). */
  url: string;
  /** name to store the database under; defaults to the URL's last path segment. */
  fileName?: string;
  /** metadata to store with it and read back from `sqlList` */
  meta?: Record<string, unknown>;
}

/** Progress tick for a SQL import. `download` repeats as bytes arrive (URL
 *  imports), `import` = writing into OPFS + the WAL normalization, then
 *  `done` / `error`. Files are imported one at a time, so `completed`/`total`
 *  give you "fetching file X of Y" and `loaded`/`totalBytes` the percentage. */
export interface SqlImportProgress {
  completed: number;
  total: number;
  /** index into the `files` array you passed */
  index: number;
  fileName: string;
  /** the URL being fetched (URL imports only) */
  url?: string;
  phase: 'download' | 'import' | 'done' | 'error';
  /** bytes downloaded so far (download phase) */
  loaded?: number;
  /** total bytes, when the server sent a content-length */
  totalBytes?: number;
}

export interface SqlImportUrlResult extends SqlImportResult {
  /** files whose download or write failed — never aborts the rest of the batch. */
  failed: { url: string; error: string }[];
}

/** One SESSION-ONLY external app entry for
 *  {@link TredespaceClient.externalAppsSet}. Mirrors the Settings → External
 *  fields; only `name` and `url` are required. */
export interface HostExternalApp {
  /** ribbon button + panel title */
  name: string;
  url: string;
  /** ribbon section title — apps sharing a section are grouped together */
  section?: string;
  /** ribbon button size (default 'medium') */
  size?: 'big' | 'medium' | 'small';
  tooltip?: string;
  /** allow several instances of this app open at once */
  multiple?: boolean;
  /** open in a new browser tab instead of an in-app panel (never auto-opened —
   *  window.open without a user gesture is popup-blocked) */
  newWindow?: boolean;
  /** open as a centered modal dialog over the app */
  modal?: boolean;
  /** Put the button on the HOME ribbon instead of External — for a tool the
   *  user should see immediately (a project selector, a report picker). It
   *  shows in one place, not both; `section` still titles its group. */
  home?: boolean;
  /** Which end of the Home ribbon the group sits at: `'start'` (default) puts
   *  it before the viewer's own Home groups, `'end'` after them. Ignored
   *  unless `home` is set. */
  homeAt?: 'start' | 'end';
  /** open immediately when this set call lands (e.g. a project selector) */
  openOnStart?: boolean;
  /** Config passed to the page as a stringified `?config=` URL param — pass an
   *  object and the viewer stringifies it.
   *
   *  For a `modal` app it ALSO sets the dialog's initial size: `width` /
   *  `height` accept `"600px"`, `"60%"` (of the viewport) or a bare number
   *  (px). Both default to `"70%"`, which is a lot of screen for a small
   *  form — set them explicitly for compact dialogs. The dialog is capped at
   *  96vw × 96vh, and the user can still move it by its title bar and resize
   *  it from the bottom-right corner.
   *
   *  ```ts
   *  { name: 'Picker', url: '…', modal: true,
   *    config: { width: '480px', height: '320px', project: 'plant-7' } }
   *  ``` */
  config?: string | Record<string, unknown>;
}

/** Progress tick for one model in an {@link TredespaceClient.assetsLoad} or
 *  {@link TredespaceClient.assetsSetLoaded} batch. Models load in parallel, so
 *  ticks interleave — `index` is the model's position in the ids you passed
 *  (for `assetsSetLoaded`, in the subset it actually had to load). */
export type LoadProgressFn = (p: LoadProgress) => void;

export interface LoadProgress {
  completed: number;
  total: number;
  index: number;
  /** the asset id this tick is about */
  id: string;
  /** `error` = that model failed to load; the batch continues either way */
  phase: 'done' | 'error';
}

/** A camera placement. The viewer's camera is ORBIT-based (Z-up): a pivot
 *  `target` plus `azimuth` / `elevation` (radians) and `distance` from the
 *  pivot. Give an eye `position` instead and the viewer converts — pass
 *  `position` + `target` if you think in eye points. Anything omitted keeps
 *  its current value, so `{ target: [x, y, z] }` re-pivots without turning. */
export interface CameraInput {
  /** eye point; converted to azimuth/elevation/distance around `target` */
  position?: [number, number, number];
  /** look-at pivot (defaults to the current pivot) */
  target?: [number, number, number];
  /** radians — ignored when `position` is given */
  azimuth?: number;
  /** radians, +Z up — ignored when `position` is given */
  elevation?: number;
  /** distance from `target` — ignored when `position` is given */
  distance?: number;
  orthographic?: boolean;
  /** glide there (default) or snap with `false` */
  animate?: boolean;
}

/** The camera's current placement, from {@link TredespaceClient.cameraGet}. */
export interface CameraState {
  target: [number, number, number];
  /** eye point, derived from the orbit parameters */
  position: [number, number, number];
  azimuth: number;
  elevation: number;
  distance: number;
  orthographic: boolean;
}

/** One open external modal dialog, from {@link TredespaceClient.uiDialogs}. */
export interface DialogInfo {
  /** dialog id — what the ui.dialog* methods address it by */
  id: string;
  /** the external-app entry it was opened from */
  appId: string;
  name: string;
  url: string;
  /** hidden but still mounted (its page keeps running and keeps its state) */
  hidden: boolean;
}

/** One configured external app, from {@link TredespaceClient.externalAppsList}. */
export interface ExternalAppInfo {
  id: string;
  name: string;
  url: string;
  section: string;
  size: 'big' | 'medium' | 'small';
  multiple: boolean;
  newWindow: boolean;
  modal: boolean;
  openOnStart: boolean;
  /** button lives on the Home ribbon rather than External */
  home: boolean;
  /** which end of the Home ribbon it sits at */
  homeAt: 'start' | 'end';
  /** true = session-only entry set through the API; false = user-configured in Settings */
  hostManaged: boolean;
}

/** The whole viewpoint set as one JSON-safe blob — exactly what the panel's
 *  Save button writes to file. Treat it as opaque: persist it, hand it back
 *  to {@link TredespaceClient.viewpointsSet}, done. */
export interface ViewpointsConfig {
  version: number;
  viewpoints: unknown[];
}

/** Payload of the unsolicited `viewpoints.bookmark` event — fired when the
 *  user clicks the host-configured bookmark button in the Viewpoints panel.
 *  Carries the CURRENT config so no follow-up `viewpointsGet` is needed. */
export interface ViewpointsBookmarkEvent {
  /** the configured button label (identifies which button, if you rename it) */
  label: string;
  config: ViewpointsConfig;
}

/** One database referenced by a script, from {@link TredespaceClient.sqlCheck}. */
export interface SqlCheckEntry {
  /** OPFS path (`sql_assets/<store>/<file>`) — the `mainDb` you passed or an
   *  `ATTACH DATABASE '…'` literal from the script. */
  path: string;
  exists: boolean;
  /** present only when `exists` */
  size?: number;
  modified?: number;
  /** import-time md5 of the delivered bytes (see {@link SqlDbInfo.md5});
   *  absent when `exists` is false or the db predates md5 recording. */
  md5?: string;
}

export interface SqlStatementResult {
  /** column names, or null for a statement that returned no result set. */
  columns: string[] | null;
  /** result rows as compact value arrays (parallel to `columns`). */
  rows: unknown[];
  /** total rows the statement produced, before any `maxRows` truncation. */
  rowCount: number;
  /** present + true when `rows` was cut to `maxRows`. */
  truncated?: boolean;
}

/** One statement of a `sqlExecute` batch — the contract the viewer's SQL
 *  editor (and the original sqllitedebug tool) run on. */
export interface SqlStatementInput {
  /** label echoed in the result and in statement-progress ticks */
  name?: string;
  sql: string;
  /** One value array per execution. Several rows = the statement is prepared
   *  once and stepped per row (bulk INSERT without a giant SQL string);
   *  exactly one row = a plain bound statement. `null` binds NULL. */
  binding?: (string | number | null)[][];
  /** keep this statement's rows (default false — a write returns nothing) */
  collect?: boolean;
}

export interface SqlExecuteStatementResult extends SqlStatementResult {
  /** the `name` you gave, when any */
  name?: string;
}

export interface SqlExecuteResult {
  /** one entry per statement, in order; rows only for `collect: true` */
  statements: SqlExecuteStatementResult[];
  ms: number;
}

/** Progress tick for a `sqlExecute` batch. `statement` ticks fire as each
 *  statement FINISHES (`no` = its index, `total` = statement count, `name` its
 *  label when given); `row` ticks fire every `progressSize` rows within the
 *  current statement (`total` is null — sqlite can't know it up front). */
export interface SqlExecuteProgress {
  type: 'statement' | 'row';
  no: number;
  total: number | null;
  name?: string;
}

/** One FILTER_ARGS entry for a report-shaped SQL call: `value` is one row,
 *  `values` one row per entry — read them back with
 *  `select v from FILTER_ARGS where k = '…'`. */
export interface SqlFilterInput {
  key: string;
  value?: string | number;
  values?: string[];
}

/** Common payload of the report-shaped SQL commands. `mainDb` may be omitted
 *  when the SQL only ATTACHes files. */
export interface SqlRunInput {
  sql: string;
  mainDb?: string;
  /** extra database paths to lock alongside (ATTACH literals are found anyway) */
  attach?: string[];
  filters?: SqlFilterInput[];
}

/** A host's own Set Color configuration — the same `rules` shape
 *  {@link TredespaceClient.colorRulesSet} takes, plus the run mode. Pass one
 *  with `custom-set` to paint a config you store yourself (the viewer's Set
 *  Color panel is neither read nor written). */
export interface SetColorConfig {
  rules: ColorRuleInput[];
  /** 'reset' (default) clears existing overrides first, 'append' layers,
   *  'hide' hides everything the rules do not match */
  mode?: 'reset' | 'append' | 'hide';
}

/**
 * How a colouring result is painted: a base coat over the whole model, then
 * the matched names on top. The `default-*` types are the viewer's own
 * buttons; the `custom-*` ones let you pick the highlight colour and bring
 * your own base or rule set. Every opacity here is 0-1.
 *
 * A colour is `'#rrggbb'` or a CSS colour name — {@link TredespaceClient.colorsNames}
 * lists the ~147 the viewer knows, and the same tokens work in a query's
 * `fullname_color` column.
 */
export type ColorMode =
  /** everything white, the hits in their own colours (yellow by default) */
  | { type: 'default-white' }
  /** everything faded to opacity 0, the hits re-shown — an isolate */
  | { type: 'default-hidden' }
  /** white base at `opacity` (default 0.1): the model stays faintly visible */
  | { type: 'default-transparent'; opacity?: number }
  /** the viewer's LIVE Set Color rules as the base (its state is only read) */
  | { type: 'default-set' }
  /** your colour for hits that carry none, over a base you choose */
  | {
      type: 'custom-color';
      color: string;
      /** opacity for the hits (default: fully opaque) */
      opacity?: number;
      /** base coat; 'none' paints the hits over the model as it is (default 'white') */
      base?: 'white' | 'transparent' | 'hidden' | 'none';
      /** 'transparent' base only (default 0.1) */
      baseOpacity?: number;
    }
  /** your own Set Color config as the base, then the hits on top */
  | { type: 'custom-set'; color?: string; opacity?: number; setConfig: SetColorConfig };

export interface SqlColorResult {
  /** the `type` of the mode that ran */
  mode: string;
  /** distinct fullnames the query returned — the rows themselves never left
   *  the viewer */
  rows: number;
  ms: number;
}

export interface SqlSelectResult {
  /** distinct fullnames the query returned */
  rows: number;
  /** how many resolved to something in the loaded models */
  matched: number;
  /** how many resolved to nothing */
  missed: number;
  ms: number;
}

/** One entry of a binary name list — what {@link encodeNameList} takes and
 *  {@link decodeNameList} gives back. */
export interface NameListEntry {
  fullname: string;
  /** '#ff0000', 'yellow', or 'default' to restore the mesh colour */
  color?: string;
  /** 0-100; omitted (or 100) = opaque */
  opacity?: number;
}

export interface NameListResult {
  /** names in the list you sent */
  names: number;
}

export interface SelectionListResult extends NameListResult {
  matched: number;
  missed: number;
}

export interface SqlQueryResult {
  /** one entry per statement in the script, in order. */
  statements: SqlStatementResult[];
  /** wall-clock milliseconds for the run. */
  ms: number;
}

/** One ancestor of a clicked tree row. `folder` entries are import folders
 *  (with their cumulative path); `node` entries are model hierarchy levels. */
export interface TreeSelectParent {
  name: string;
  type: 'folder' | 'node';
  /** cumulative folder path — folder parents only */
  path?: string;
}

/** Unsolicited `tree.select` event: the user clicked a row in the tree view,
 *  picked an item in the viewport, or walked the selection with U / P. */
export interface TreeSelectEvent {
  /** fullname of the clicked node (folder path for folder rows) */
  fullname: string;
  name: string;
  /** true for import folders and hierarchy nodes with children */
  folder: boolean;
  /** the import folder the model lives in (item rows only) */
  group?: string;
  /** every parent up to the root, outermost first */
  parents: TreeSelectParent[];
}

// ── client ───────────────────────────────────────────────────────────────────

/**
 * Encode fullnames as the binary list the viewer's packed path reads:
 * UTF-8, one `fullname` (or `fullname\tcolor[:opacity]`) per line. Hand the
 * result to {@link TredespaceClient.selectionSetList} or
 * {@link TredespaceClient.colorApplyList} — it is transferred, so a million
 * names cost one buffer instead of a million JSON strings on each side.
 * Names are matched case-insensitively by the viewer.
 */
export function encodeNameList(entries: readonly (string | NameListEntry)[]): ArrayBuffer {
  const lines: string[] = [];
  for (const e of entries) {
    if (typeof e === 'string') {
      const name = e.trim();
      if (name) {
        lines.push(name);
      }
      continue;
    }
    const name = (e.fullname ?? '').trim();
    if (!name) {
      continue;
    }
    if (!e.color) {
      lines.push(name);
      continue;
    }
    const op = e.opacity == null || e.opacity >= 100 ? '' : `:${Math.max(0, Math.round(e.opacity))}`;
    lines.push(`${name}\t${e.color}${op}`);
  }
  return new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer;
}

/** Read a binary name list back (the inverse of {@link encodeNameList}) — for
 *  a list you cached, or one you received from elsewhere. */
export function decodeNameList(bytes: ArrayBuffer | Uint8Array): NameListEntry[] {
  const text = new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const out: NameListEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const m = line.match(/^(.*?)[\t, ]+([^\t, ]+)$/);
    const head = m?.[1].trim();
    if (!m || !head) {
      out.push({ fullname: line });
      continue;
    }
    const [color, op] = m[2].split(':');
    const opacity = op === undefined || op === '' ? undefined : Number(op);
    out.push({
      fullname: head,
      color,
      ...(opacity !== undefined && Number.isFinite(opacity) ? { opacity } : {}),
    });
  }
  return out;
}

export interface TredespaceClientOptions {
  /** The viewer's origin, e.g. 'https://viewer.example.com'. Required. */
  targetOrigin: string;
  /** Aborting this signal calls `dispose()` — one AbortController can own the
   *  client AND every subscription made with `{ signal }`. */
  signal?: AbortSignal;
  /** Per-command timeout (ms). Imports use importTimeoutMs. Default 30 000. */
  timeoutMs?: number;
  /** Timeout for assets.import (conversions can be long). Default 600 000. */
  importTimeoutMs?: number;
}

/** Options for `on()` and the typed `on*` helpers. */
export interface SubscribeOptions {
  /** Aborting the signal unsubscribes — the `addEventListener` idiom, so one
   *  AbortController can end many subscriptions (and the client) at once. */
  signal?: AbortSignal;
}

interface Pending {
  settle: (r: Result<unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Blob/File payloads at or above this size are streamed in chunks rather than
 *  sent as one message, so a multi-GB import never allocates one huge buffer. */
const CHUNKED_UPLOAD_THRESHOLD = 500 * 1024 * 1024;
/** Per-chunk transfer size for large uploads. */
const UPLOAD_CHUNK_SIZE = 64 * 1024 * 1024;

export class TredespaceClient {
  private target: Window | null;
  private readonly origin: string;
  private readonly timeoutMs: number;
  private readonly importTimeoutMs: number;
  private readonly pending = new Map<string, Pending>();
  private readonly eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  // random per-instance prefix: several clients sharing one transport (e.g. a
  // future BroadcastChannel) can never collide on correlation ids
  private readonly idPrefix = `ts-${Math.random().toString(36).slice(2, 10)}`;
  private nextId = 1;
  private readyPayload: AppReady | null = null;
  private readyWaiters: ((r: AppReady) => void)[] = [];
  private readonly onMessage = (e: MessageEvent) => this.handle(e);

  constructor(target: Window | HTMLIFrameElement, opts: TredespaceClientOptions) {
    this.target = target instanceof HTMLIFrameElement ? target.contentWindow : target;
    this.origin = opts.targetOrigin;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.importTimeoutMs = opts.importTimeoutMs ?? 600_000;
    window.addEventListener('message', this.onMessage);
    if (opts.signal?.aborted) {
      this.dispose();
    } else {
      opts.signal?.addEventListener('abort', () => this.dispose(), { once: true });
    }
  }

  /** Resolves once the viewer has announced app.ready (queues until then). */
  ready(): Promise<AppReady> {
    if (this.readyPayload) {
      return Promise.resolve(this.readyPayload);
    }
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  /** Detach the message listener and settle every in-flight request with a
   *  `transport` error. Call when the host tears down the iframe. */
  dispose() {
    window.removeEventListener('message', this.onMessage);
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.settle({ error: { code: 'transport', msg: 'client disposed' } });
    }
    this.pending.clear();
    this.target = null;
  }

  // ── commands (one method per EVENTS.md entry) ─────────────────────────────

  /** Replace the selection by fullname (reveals the first hit in the tree).
   *  `append: true` keeps what is already selected and adds to it instead.
   *  `missed` lists fullnames that resolved to nothing. */
  selectionSet(fullnames: string[], opts?: { append?: boolean }): Promise<Result<SelectionSetResult>> {
    return this.send('selection.set', { fullnames, append: opts?.append ?? false });
  }
  /** Select a LARGE fullname list: build it with {@link encodeNameList} and
   *  it travels as one transferred buffer, packed straight into the model DB —
   *  no per-row JSON on either side. `append` adds to the current selection.
   *  For a handful of names {@link selectionSet} is simpler. */
  selectionSetList(list: ArrayBuffer, opts?: { append?: boolean }): Promise<Result<SelectionListResult>> {
    return this.send(
      'selection.setList',
      { append: opts?.append ?? false },
      { bytes: list, timeoutMs: this.importTimeoutMs },
    );
  }
  /** Clear the current selection. */
  selectionClear(): Promise<Result<Record<string, never>>> {
    return this.send('selection.clear', {});
  }
  /** Read the current selection: the count, the selection roots as
   *  fullnames, and with `{ items: true }` every selected node — grouping
   *  entries and leaves, children included, minus `skip` prefixes, capped at
   *  `maxItems` — the form to use after invert / API / SQL selections, which
   *  have no tree roots. */
  selectionGet(opts: SelectionGetOptions = {}): Promise<Result<SelectionGetResult>> {
    return this.send('selection.get', { ...opts });
  }

  /** Replace all scene labels. Each label anchors either to a world-space
   *  `anchor` point or to a `fullname` (the item's bounds centre); `missed`
   *  lists fullnames that resolved to nothing. */
  labelsSet(labels: LabelInput[]): Promise<Result<LabelsResult>> {
    return this.send('labels.set', { labels });
  }
  /** Append scene labels (same anchor forms as {@link labelsSet}). */
  labelsAdd(labels: LabelInput[]): Promise<Result<LabelsResult>> {
    return this.send('labels.add', { labels });
  }
  /** Remove every scene label. */
  labelsClear(): Promise<Result<Record<string, never>>> {
    return this.send('labels.clear', {});
  }
  /** Spread overlapping labels apart from their anchors (the in-app explode). */
  labelsExplode(): Promise<Result<Record<string, never>>> {
    return this.send('labels.explode', {});
  }
  /** Pull exploded labels back onto their anchor points. */
  labelsImplode(): Promise<Result<Record<string, never>>> {
    return this.send('labels.implode', {});
  }

  /** Replace all measurements (world-space points; same shape as the
   *  measurements JSON export). */
  measurementsSet(measurements: MeasurementInput[]): Promise<Result<{ added: number }>> {
    return this.send('measurements.set', { measurements });
  }
  /** Append measurements (same shape as {@link measurementsSet}). */
  measurementsAdd(measurements: MeasurementInput[]): Promise<Result<{ added: number }>> {
    return this.send('measurements.add', { measurements });
  }
  /** Remove every measurement. */
  measurementsClear(): Promise<Result<Record<string, never>>> {
    return this.send('measurements.clear', {});
  }

  /** Run a rule set DIRECTLY, without touching the Set Color panel — same
   *  rule shape as {@link colorRulesSet}, but the panel's own rules/mode stay
   *  as they are (nothing to clean up afterwards). `mode` defaults to
   *  'reset'; disabled rules are skipped. Returns per-enabled-rule match
   *  counts. */
  colorRulesApply(
    rules: ColorRuleInput[],
    opts?: { mode?: 'reset' | 'append' | 'hide' },
  ): Promise<Result<{ ran: boolean; matches: number[] }>> {
    return this.send('colorRules.apply', { rules, mode: opts?.mode ?? 'reset' });
  }
  /** Replace the Set-Color rules. `mode:'append'` keeps existing rules
   *  (default 'reset' replaces); `mode:'hide'` runs hide-model style — hide
   *  everything, the rules unhide and colour their matches; `run:true`
   *  applies them immediately. */
  colorRulesSet(
    rules: ColorRuleInput[],
    opts?: { mode?: 'reset' | 'append' | 'hide'; run?: boolean },
  ): Promise<Result<ColorRulesResult>> {
    return this.send('colorRules.set', { rules, mode: opts?.mode ?? 'reset', run: opts?.run ?? false });
  }
  /** Append Set-Color rules; `run:true` applies them immediately. */
  colorRulesAdd(rules: ColorRuleInput[], opts?: { run?: boolean }): Promise<Result<ColorRulesResult>> {
    return this.send('colorRules.add', { rules, run: opts?.run ?? false });
  }
  /** Colour a LARGE fullname list you computed yourself: build it with
   *  {@link encodeNameList} (per-name colours optional) and it travels as one
   *  transferred buffer, packed viewer-side. `mode` is the same
   *  {@link ColorMode} {@link sqlColor} takes — including
   *  `{ type: 'custom-color', base: 'none' }` to paint the list over the model
   *  as it is. Names carrying no colour of their own get the mode's colour
   *  (yellow by default). */
  colorApplyList(list: ArrayBuffer, opts?: { mode?: ColorMode }): Promise<Result<NameListResult & { mode: string }>> {
    return this.send(
      'colorRules.applyList',
      { mode: opts?.mode ?? { type: 'default-white' } },
      { bytes: list, timeoutMs: this.importTimeoutMs },
    );
  }
  /** Every colour NAME the viewer accepts wherever a colour token is read — a
   *  query's `fullname_color`, a Multi rule row, a {@link ColorMode}'s
   *  `color` — as `{ name: '#rrggbb' }`. Hex codes always work too; this is
   *  the list for validating or offering names in your own UI. */
  colorsNames(): Promise<Result<{ names: Record<string, string> }>> {
    return this.send('colors.names', {});
  }
  /** Re-run the current rules against the model; returns matched item counts. */
  colorRulesRun(): Promise<Result<{ matches: number[] }>> {
    return this.send('colorRules.run', {});
  }
  /** Remove all Set-Color rules. Does NOT restore already-painted colors — use
   *  {@link colorRulesResetModel} for that. */
  colorRulesClear(): Promise<Result<Record<string, never>>> {
    return this.send('colorRules.clear', {});
  }
  /** Reset the model's color/opacity overrides (the in-app Alt+R action). */
  colorRulesResetModel(): Promise<Result<Record<string, never>>> {
    return this.send('colorRules.resetModel', {});
  }
  /** Reset the model's overrides — colors, opacity overrides, hidden items and
   *  item transforms. Naming kinds resets ONLY those (`{ hidden: true }`
   *  unhides and leaves the colors alone); an empty payload resets all four.
   *  The response echoes which kinds were reset. */
  modelReset(opts?: ModelResetOptions): Promise<Result<ModelResetResult>> {
    return this.send('model.reset', { ...opts });
  }

  // ── clipping box + shapes ─────────────────────────────────────────────────
  /** The default clipping box: whether it is cutting, whether it is inverted,
   *  its world-space `min`/`max` (axis-aligned envelope — exact unless the box
   *  is rotated) plus the exact oriented box. Intersect `min`/`max` with your
   *  own asset bounds to decide which models to load. */
  clipBoxGet(): Promise<Result<ClipBoxState>> {
    return this.send('clip.box.get', {});
  }
  /** Fit the clip box to the current selection. `offset` adds a margin on every
   *  side for THIS call only (it doesn't change the panel's stored offset). */
  clipBoxFitSelected(offset?: number): Promise<Result<{ offset: number }>> {
    return this.send('clip.box.fitSelected', offset === undefined ? {} : { offset });
  }
  /** Append clip shapes (sphere/cylinder/box). Returns how many were added. */
  clipShapesAdd(shapes: ClipShapeInput[]): Promise<Result<{ added: number }>> {
    return this.send('clip.shapes.add', { shapes });
  }
  /** Turn box clipping off (leaves any clip shapes in place). */
  clipBoxDisable(): Promise<Result<Record<string, never>>> {
    return this.send('clip.box.disable', {});
  }
  /** Full clip reset — disable the box AND remove every clip shape. */
  clipReset(): Promise<Result<Record<string, never>>> {
    return this.send('clip.reset', {});
  }

  // ── navigation ────────────────────────────────────────────────────────────
  /** Fly the camera to a node by fullname. `select` also selects it (default
   *  just flies); `wait` responds only once the camera has ARRIVED, so a
   *  chained screenshot or command sees the final view. `matched` is false
   *  when the fullname isn't found. */
  navFlyTo(fullname: string, opts?: { select?: boolean; wait?: boolean }): Promise<Result<{ matched: boolean }>> {
    return this.send('nav.flyTo', { fullname, select: opts?.select ?? false, wait: opts?.wait ?? false });
  }
  /** Set the orbit pivot to a node by fullname (camera stays); `select` also
   *  selects it, `wait` responds only once the re-pivot has landed. `matched`
   *  is false when the fullname isn't found. */
  navOrbit(fullname: string, opts?: { select?: boolean; wait?: boolean }): Promise<Result<{ matched: boolean }>> {
    return this.send('nav.orbit', { fullname, select: opts?.select ?? false, wait: opts?.wait ?? false });
  }
  /** Frame everything currently VISIBLE — every item that is not hidden,
   *  moved geometry included — as tightly as the viewport allows. `wait`
   *  responds only once the camera has arrived. `fitted` is false when
   *  nothing visible is left to frame. */
  navFitVisible(opts?: { wait?: boolean }): Promise<Result<{ fitted: boolean }>> {
    return this.send('nav.fitVisible', { wait: opts?.wait ?? false });
  }

  /** Read-only snapshot of the persisted viewer settings, plus the app version. */
  settingsGet(): Promise<Result<SettingsGetResult>> {
    return this.send('settings.get', {});
  }

  /** Toggle sketch mode (white background + edge lines), or set it explicitly
   *  by passing `on`. Returns the resulting state. */
  viewSketch(on?: boolean): Promise<Result<{ sketch: boolean }>> {
    return this.send('view.sketch', on === undefined ? {} : { on });
  }

  /** Capture the current viewport as a PNG — the converged frame (edges, AA,
   *  AO, view cube) plus the label and measurement overlays, exactly as shown.
   *  Returns a `data:image/png;base64,…` URL (drop it straight into an `<img>`
   *  src or a download link) and the pixel size. */
  viewScreenshot(): Promise<Result<{ dataUrl: string; width: number; height: number }>> {
    return this.send('view.screenshot', {});
  }

  /** List the stores (projects). Fetch this first to know valid `store` names
   *  for assetsList / assetsLoad / assetsImport. */
  storesList(): Promise<Result<{ stores: StoreInfo[] }>> {
    return this.send('stores.list', {});
  }

  /** Create a store (project) with an optional description. Idempotent — an
   *  existing name (or 'main') resolves with `created:false` and the current
   *  store, so it is safe to call before targeting a store you're not sure
   *  exists. The name is sanitised (slashes → '-', trimmed, capped at 60). */
  storesCreate(name: string, opts?: { description?: string }): Promise<Result<{ created: boolean; store: StoreInfo }>> {
    return this.send('stores.create', { name, description: opts?.description ?? '' });
  }

  /** List assets. Pass `store` to list just that store (must be a known name). */
  assetsList(store?: string): Promise<Result<{ assets: AssetInfo[] }>> {
    return this.send('assets.list', store === undefined ? {} : { store });
  }

  /** Send a file for conversion into the asset manager.
   *
   *  `bytes` may be an ArrayBuffer (TRANSFERRED - unusable in the host after) or
   *  a Blob/File (passed by reference, not detached). A Blob/File at or above
   *  500 MB is automatically streamed in 64 MB chunks (many small postMessages,
   *  reassembled in the viewer) so multi-GB files import without ever allocating
   *  one huge buffer. Everything is plain postMessage - cross-origin safe.
   *
   *  Import does NOT render - call `assetsLoad` afterwards, or use
   *  `assetsImportAndLoad`. `onProgress` (0..1) fires per chunk for large files. */
  assetsImport(input: {
    fileName: string;
    format: ImportFormat;
    bytes: ArrayBuffer | Blob;
    folder?: string;
    /** destination store (default 'main'); must be a known store name */
    store?: string;
    /** delete any prior asset sharing this one's store + folder + name */
    replace?: boolean;
    /** per-format options, e.g. { normals: true, edges: true } for glb-standard */
    options?: Record<string, unknown>;
    /** metadata stored with the produced asset(s), returned by `assetsList` */
    meta?: Record<string, unknown>;
    /** upload progress (0..1); only fires for chunk-streamed large files */
    onProgress?: (fraction: number) => void;
  }): Promise<Result<AssetsImportResult>> {
    const { bytes, onProgress, ...payload } = input;
    const size = bytes instanceof Blob ? bytes.size : bytes.byteLength;
    if (bytes instanceof Blob && size >= CHUNKED_UPLOAD_THRESHOLD) {
      return this.chunkedImport(bytes, payload, onProgress);
    }
    // Small Blob/File: read it HERE (the host) and transfer the ArrayBuffer.
    // The viewer must not read a picked File across postMessage - the file
    // reference doesn't survive the boundary and throws NotReadableError.
    if (bytes instanceof Blob) {
      return bytes
        .arrayBuffer()
        .then((buf) =>
          this.send<AssetsImportResult>('assets.import', payload, { bytes: buf, timeoutMs: this.importTimeoutMs }),
        );
    }
    return this.send<AssetsImportResult>('assets.import', payload, { bytes, timeoutMs: this.importTimeoutMs });
  }

  /** Import then immediately load the produced assets - the "import a sample and
   *  show it" flow. Returns the import result plus how many were loaded. */
  async assetsImportAndLoad(
    input: Parameters<TredespaceClient['assetsImport']>[0] & {
      fit?: boolean;
      /** place the camera instead of fitting — see `assetsLoad` */
      camera?: CameraInput;
      cameraFirst?: boolean;
    },
  ): Promise<Result<AssetsImportResult & { loaded: number }>> {
    const { fit, camera, cameraFirst, ...imp } = input;
    const res = await this.assetsImport(imp);
    if (res.error) {
      return { error: res.error };
    }
    const data = res.data as AssetsImportResult;
    const ids = data.entries.map((e) => e.id);
    let loaded = 0;
    if (ids.length) {
      const lr = await this.assetsLoad(ids, {
        fit: fit ?? true,
        ...(input.store ? { store: input.store } : {}),
        ...(camera ? { camera } : {}),
        ...(cameraFirst !== undefined ? { cameraFirst } : {}),
      });
      if (lr.error) {
        return { error: lr.error };
      }
      loaded = (lr.data as { loaded: number }).loaded;
    }
    return { data: { ...data, loaded } };
  }

  /** Batch-import files the VIEWER downloads by URL - nothing rides
   *  postMessage, so a host can queue many/large models without shipping their
   *  bytes across the frame. Each file names its own `format` (required - a
   *  `.glb` URL is ambiguous between merged and standard, so nothing is
   *  inferred on the wire).
   *
   *  `concurrent` (default 3, clamped 1..8) files are processed at once
   *  END-TO-END: for glb/tdp each slot downloads AND cooks, so a slow download
   *  never stalls a cook that is ready to run. The rvm/ifc/step converters are
   *  multi-phase and stage through shared temp dirs, so they run one after
   *  another (their downloads still stream inside the same batch).
   *
   *  Passing `onProgress` also puts the viewer in QUIET mode: it drives no
   *  import dialogs at all, leaving the progress UI entirely to the host.
   *  Ticks carry the file `index`, its phase, and downloaded bytes - see
   *  {@link ImportUrlProgress}. Without `onProgress` the viewer shows its own
   *  import overlay as usual.
   *
   *  One `results` entry per input file, in input order; a download or convert
   *  failure is recorded there and never aborts the batch. URLs are fetched
   *  under the VIEWER origin's CORS, not the host's. */
  assetsImportUrl(
    files: ImportUrlFile[],
    opts?: {
      /** files processed at once — download AND cook (default 3, clamped 1..8
       *  by the viewer). */
      concurrent?: number;
      /** destination store (default 'main'); must be a known store name. */
      store?: string;
      /** delete any prior asset sharing each new one's store + folder + name. */
      replace?: boolean;
      /** per-file progress; also suppresses the viewer's own import dialogs. */
      onProgress?: (p: ImportUrlProgress) => void;
    },
  ): Promise<Result<AssetsImportUrlResult>> {
    const batchId = `${this.idPrefix}-batch-${this.nextId++}`;
    const off = opts?.onProgress
      ? this.on('assets.importUrl:progress', (p) => {
          const pr = p as ImportUrlProgress & { batchId?: string };
          if (pr.batchId === batchId) {
            opts.onProgress?.(pr);
          }
        })
      : undefined;
    // one file can be a long cook; give the whole batch room beyond one import.
    const timeoutMs = this.importTimeoutMs * Math.max(1, files.length);
    return this.send<AssetsImportUrlResult>(
      'assets.importUrl',
      {
        files,
        batchId,
        // tells the viewer the host draws its own progress UI: no app dialogs
        ...(opts?.onProgress ? { progress: true } : {}),
        ...(opts?.concurrent !== undefined ? { concurrent: opts.concurrent } : {}),
        ...(opts?.store ? { store: opts.store } : {}),
        ...(opts?.replace ? { replace: opts.replace } : {}),
      },
      { timeoutMs },
    ).finally(() => off?.());
  }

  /** Stream a large Blob/File to the viewer in chunks, then import it. Used
   *  automatically by `assetsImport` for payloads >= the threshold. */
  private async chunkedImport(
    blob: Blob,
    payload: {
      fileName: string;
      format: ImportFormat;
      folder?: string;
      store?: string;
      replace?: boolean;
      options?: Record<string, unknown>;
    },
    onProgress?: (fraction: number) => void,
  ): Promise<Result<AssetsImportResult>> {
    const begin = await this.send<{ uploadId: string }>(
      'assets.uploadBegin',
      { fileName: payload.fileName, size: blob.size },
      { timeoutMs: this.importTimeoutMs },
    );
    if (begin.error) {
      return { error: begin.error };
    }
    const { uploadId } = begin.data as { uploadId: string };
    const total = blob.size;
    for (let offset = 0; offset < total; offset += UPLOAD_CHUNK_SIZE) {
      const end = Math.min(offset + UPLOAD_CHUNK_SIZE, total);
      // only one chunk is in memory at a time; its ArrayBuffer is transferred
      const buf = await blob.slice(offset, end).arrayBuffer();
      const chunk = await this.send(
        'assets.uploadChunk',
        { uploadId, offset },
        { bytes: buf, timeoutMs: this.importTimeoutMs },
      );
      if (chunk.error) {
        await this.send('assets.uploadAbort', { uploadId }); // best-effort cleanup
        return { error: chunk.error };
      }
      onProgress?.(end / total);
    }
    return this.send<AssetsImportResult>(
      'assets.uploadFinish',
      { uploadId, ...payload },
      { timeoutMs: this.importTimeoutMs },
    );
  }

  /** Render imported assets into the viewer. The camera follows one of three
   *  rules: `fit: true` (the default) frames what was loaded; `fit: false`
   *  leaves the camera exactly where it is; a `camera` places it explicitly
   *  and replaces the framing entirely, so the view never fits first and then
   *  jumps. Pair with {@link assetsImport}, or use {@link assetsImportAndLoad}.
   *
   *  Models load in parallel (`concurrent`, default the viewer's load-pool
   *  setting). Pass `onProgress` for a tick per model as it lands — that also
   *  puts the viewer in quiet mode, so it drives no loading overlay and the
   *  progress UI is entirely yours. Without it the viewer shows its own
   *  overlay, exactly like loading from the Model Assets panel. */
  assetsLoad(
    ids: string[],
    opts?: {
      fit?: boolean;
      store?: string;
      camera?: CameraInput;
      /** With a `camera`: move BEFORE the models load (default true — the
       *  move is awaited, so the view has arrived as they appear) or after
       *  (`false`). */
      cameraFirst?: boolean;
      concurrent?: number;
      onProgress?: LoadProgressFn;
    },
  ): Promise<Result<{ loaded: number }>> {
    return this.loadCall('assets.load', { ids, fit: opts?.fit ?? true }, opts);
  }
  /** Remove assets from the viewport (they stay in the asset manager). */
  assetsUnload(ids: string[]): Promise<Result<{ unloaded: number }>> {
    return this.send('assets.unload', { ids });
  }

  /** Declaratively set WHICH assets are loaded: after this call the loaded
   *  set is exactly `ids` — anything loaded but not listed is unloaded,
   *  anything listed but not yet loaded is loaded, anything already right is
   *  untouched (idempotent, so a sync can call it every cycle). An empty
   *  array unloads everything. `store` scopes both directions to that store —
   *  assets in other stores are never touched. `fit` is OPT-IN here (a
   *  background sync should not move the camera) and frames the union of the
   *  whole desired set, not just what this call loaded. `missing` returns
   *  requested ids that are not in the asset manager — import those first. */
  assetsSetLoaded(
    ids: string[],
    opts?: {
      store?: string;
      fit?: boolean;
      camera?: CameraInput;
      /** With a `camera`: move BEFORE the loads (default true) or after (`false`). */
      cameraFirst?: boolean;
      concurrent?: number;
      onProgress?: LoadProgressFn;
    },
  ): Promise<Result<{ loaded: number; unloaded: number; missing: string[] }>> {
    return this.loadCall('assets.setLoaded', { ids, ...(opts?.fit !== undefined ? { fit: opts.fit } : {}) }, opts);
  }

  /** Shared plumbing for the two load commands: subscribes to this batch's
   *  progress ticks while it runs and tells the viewer to keep its own
   *  overlay down whenever the host is drawing one. */
  private loadCall<T>(
    type: string,
    payload: Record<string, unknown>,
    opts?: {
      store?: string;
      camera?: CameraInput;
      cameraFirst?: boolean;
      concurrent?: number;
      onProgress?: LoadProgressFn;
    },
  ): Promise<Result<T>> {
    const batchId = `${this.idPrefix}-load-${this.nextId++}`;
    const off = opts?.onProgress
      ? this.on('assets.load:progress', (p) => {
          const pr = p as LoadProgress & { batchId?: string };
          if (pr.batchId === batchId) {
            opts.onProgress?.(pr);
          }
        })
      : undefined;
    return this.send<T>(type, {
      ...payload,
      batchId,
      ...(opts?.onProgress ? { progress: true } : {}),
      ...(opts?.store ? { store: opts.store } : {}),
      ...(opts?.camera ? { camera: opts.camera } : {}),
      ...(opts?.cameraFirst !== undefined ? { cameraFirst: opts.cameraFirst } : {}),
      ...(opts?.concurrent !== undefined ? { concurrent: opts.concurrent } : {}),
    }).finally(() => off?.());
  }

  /** Delete persisted assets from local storage (OPFS). A copy already loaded
   *  into the viewer stays on screen - import -> load -> remove leaves a
   *  session-only model with nothing on disk. */
  assetsRemove(ids: string[], opts?: { store?: string }): Promise<Result<{ removed: number }>> {
    return this.send('assets.remove', { ids, ...(opts?.store ? { store: opts.store } : {}) });
  }

  // ── SQL databases (SQLite in OPFS, stores shared with model assets) ───────
  /** List SQLite databases. Pass `store` to list just that store (a known
   *  name). Each db's `path` is what you pass as `mainDb` to `sqlQuery`. */
  sqlList(store?: string): Promise<Result<{ dbs: SqlDbInfo[] }>> {
    return this.send('sql.list', store === undefined ? {} : { store });
  }

  /** Import a .db/.sqlite file into a store (default 'main'). `bytes` is an
   *  ArrayBuffer (TRANSFERRED — unusable after) or a Blob/File (by reference).
   *  `replace: true` overwrites an existing same-name db; false (default) skips
   *  it. WAL databases are normalised to rollback journalling on the way in
   *  (the OPFS VFS is shm-less, so WAL can't be read shared). The md5 of the
   *  bytes as delivered is recorded and returned by `sqlList` — hash your
   *  source file and compare to decide whether an import is needed at all. */
  sqlImport(input: {
    fileName: string;
    bytes: ArrayBuffer | Blob;
    /** destination store (default 'main'); must be a known store name */
    store?: string;
    replace?: boolean;
    /** metadata stored with the database, returned by `sqlList` */
    meta?: Record<string, unknown>;
    /** per-phase progress; also silences the viewer's own dialogs */
    onProgress?: (p: SqlImportProgress) => void;
  }): Promise<Result<SqlImportResult>> {
    const { bytes, onProgress, ...rest } = input;
    const { payload, done } = this.sqlProgress(rest, onProgress);
    // A picked File must be read HERE and transferred — a File reference does
    // not survive postMessage into the viewer (NotReadableError otherwise).
    if (bytes instanceof Blob) {
      return bytes
        .arrayBuffer()
        .then((buf) =>
          this.send<SqlImportResult>('sql.import', payload, { bytes: buf, timeoutMs: this.importTimeoutMs }),
        )
        .finally(done);
    }
    return this.send<SqlImportResult>('sql.import', payload, { bytes, timeoutMs: this.importTimeoutMs }).finally(done);
  }

  /** Subscribe to this batch's SQL import ticks and tag the payload so the
   *  viewer keeps its own dialogs down while the host draws progress. */
  private sqlProgress(
    payload: Record<string, unknown>,
    onProgress?: (p: SqlImportProgress) => void,
  ): { payload: Record<string, unknown>; done: () => void } {
    if (!onProgress) {
      return { payload, done: () => undefined };
    }
    const batchId = `${this.idPrefix}-sql-${this.nextId++}`;
    const off = this.on('sql.importUrl:progress', (p) => {
      const pr = p as SqlImportProgress & { batchId?: string };
      if (pr.batchId === batchId) {
        onProgress(pr);
      }
    });
    return { payload: { ...payload, batchId, progress: true }, done: off };
  }

  /** Batch-import .db/.sqlite files the VIEWER downloads by URL — nothing
   *  rides postMessage, and each download is STREAMED straight into OPFS
   *  (constant memory, so multi-GB databases are fine). URLs are fetched
   *  under the viewer origin's CORS, not the host's. `replace: true`
   *  overwrites an existing same-name db; false (default) skips it WITHOUT
   *  downloading. The md5 of the downloaded bytes is recorded per file (see
   *  `sqlList`) — hash your hosted file and compare first to skip unchanged
   *  imports entirely. Files run serially; a download failure lands in
   *  `failed` and never aborts the rest. */
  sqlImportUrl(input: {
    files: SqlImportUrlFile[];
    /** destination store (default 'main'); must be a known store name */
    store?: string;
    replace?: boolean;
    /** per-file AND per-chunk progress — "fetching file X of Y" plus a real
     *  download percentage from `loaded`/`totalBytes`. Passing it also
     *  silences the viewer's own import dialogs. */
    onProgress?: (p: SqlImportProgress) => void;
  }): Promise<Result<SqlImportUrlResult>> {
    const { onProgress, ...rest } = input;
    const { payload, done } = this.sqlProgress(rest, onProgress);
    return this.send<SqlImportUrlResult>('sql.importUrl', payload, { timeoutMs: this.importTimeoutMs }).finally(done);
  }

  /** Pre-flight a SQL script WITHOUT running it: which databases does it
   *  reference (the optional `mainDb` plus every `ATTACH DATABASE '…'`
   *  literal, in appearance order), and are they present? Present entries
   *  carry `size` / `modified` / `md5` (import-time hash of the delivered
   *  bytes), so a host can compare against its manifest and `sqlImportUrl`
   *  only the missing or outdated files before calling `sqlQuery`. */
  sqlCheck(input: { sql: string; mainDb?: string }): Promise<Result<{ dbs: SqlCheckEntry[] }>> {
    return this.send('sql.check', input);
  }

  // ── camera ────────────────────────────────────────────────────────────────
  /** The camera's current placement — both as orbit parameters and as an eye
   *  `position`. Round-trips: hand what you get back to `cameraSet` (or to
   *  `assetsLoad`'s `camera` option) to restore this exact view. */
  cameraGet(): Promise<Result<CameraState>> {
    return this.send('camera.get', {});
  }

  /** Move the camera. Give an eye `position` + `target`, or orbit parameters;
   *  omitted fields keep their current value. `animate: false` snaps instead
   *  of gliding. Resolves once the camera has ARRIVED, so a chained call sees
   *  the final view; an explicit placement also keeps the first-model default
   *  view from overriding it. To place the camera as models appear, prefer the `camera`
   *  option on `assetsLoad` / `assetsSetLoaded` — it replaces their framing
   *  step, so the view never fits first and then jumps. */
  cameraSet(
    camera: CameraInput,
  ): Promise<Result<{ target: [number, number, number]; azimuth: number; elevation: number; distance: number }>> {
    return this.send('camera.set', { ...camera });
  }

  // ── viewpoints ────────────────────────────────────────────────────────────
  /** The whole viewpoint set as one opaque JSON blob — the same shape the
   *  panel's Save button writes to file. Persist it host-side (per user, per
   *  project…) and restore it later with `viewpointsSet`. */
  viewpointsGet(): Promise<Result<{ config: ViewpointsConfig }>> {
    return this.send('viewpoints.get', {});
  }

  /** REPLACE the current viewpoint set from a config blob (from
   *  `viewpointsGet`, a `viewpoints.bookmark` event, or a saved viewpoints
   *  JSON file — same shape). Viewpoints carry model-relative content
   *  (fullnames, positions, color rules), so restore them alongside the same
   *  loaded models. `showViewer: true` then docks the Viewpoint Viewer panel
   *  on the RIGHT and makes it active, ready to present. */
  viewpointsSet(config: ViewpointsConfig, opts?: { showViewer?: boolean }): Promise<Result<{ loaded: number }>> {
    return this.send('viewpoints.set', { config, ...(opts?.showViewer ? { showViewer: true } : {}) });
  }

  /** REPLACE the current viewpoint set from a hosted viewpoints JSON file the
   *  VIEWER downloads itself (viewer-origin CORS, like the other *Url
   *  commands) — same blob shape as `viewpointsGet` / a panel-saved file.
   *  `showViewer: true` then docks the Viewpoint Viewer panel on the RIGHT
   *  and makes it active, ready to present the loaded set (also available on
   *  `viewpointsSet`). */
  viewpointsSetUrl(url: string, opts?: { showViewer?: boolean }): Promise<Result<{ loaded: number }>> {
    return this.send('viewpoints.setUrl', { url, ...(opts?.showViewer ? { showViewer: true } : {}) });
  }

  /** Show (or remove, with null) a SESSION-ONLY bookmark button in the
   *  Viewpoints panel, between Add viewpoint and Save. When the user clicks
   *  it the viewer fires the unsolicited `viewpoints.bookmark` event with the
   *  current config attached — subscribe with `onViewpointsBookmark` and
   *  persist it wherever bookmarks live. Like host-set external apps, the
   *  button is never persisted: gone on reload until set again after
   *  `app.ready`. */
  viewpointsSetBookmarkButton(button: { label: string; tooltip?: string } | null): Promise<Result<{ shown: boolean }>> {
    return this.send('viewpoints.setBookmarkButton', { button });
  }

  /** Subscribe to the bookmark-button click event (see
   *  `viewpointsSetBookmarkButton`). Returns an unsubscribe function. */
  onViewpointsBookmark(handler: (e: ViewpointsBookmarkEvent) => void, opts?: SubscribeOptions): () => void {
    return this.on('viewpoints.bookmark', (payload) => handler(payload as ViewpointsBookmarkEvent), opts);
  }

  // ── external dialogs (open external-app modals) ───────────────────────────
  /** Every open external modal dialog, with its `hidden` state. The ids are
   *  what `uiDialogHide` / `uiDialogShow` / `uiDialogClose` address, and are
   *  also returned as `dialogId` by `externalAppsSet` for a modal it opened. */
  uiDialogs(): Promise<Result<{ dialogs: DialogInfo[] }>> {
    return this.send('ui.dialogs', {});
  }

  /** Hide a dialog WITHOUT closing it: the iframe stays mounted, so its page
   *  keeps running and keeps its state (a half-filled form, a live session)
   *  and `uiDialogShow` brings it back exactly as it was — unlike closing,
   *  which drops the context. Park a dialog while a model loads, then either
   *  show it again or close it. Omit `id` from inside an embedded app to hide
   *  the dialog hosting it. */
  uiDialogHide(id?: string): Promise<Result<{ id: string; hidden: boolean }>> {
    return this.send('ui.dialog.hide', id ? { id } : {});
  }

  /** Re-show a hidden dialog (and raise it above the other dialogs). */
  uiDialogShow(id?: string): Promise<Result<{ id: string; hidden: boolean }>> {
    return this.send('ui.dialog.show', id ? { id } : {});
  }

  /** Close a dialog by id — its page is unmounted and its context lost. Omit
   *  `id` from inside an embedded app to close the dialog hosting it (the
   *  same as `uiClose`). */
  uiDialogClose(id?: string): Promise<Result<{ id: string; closed: boolean }>> {
    return this.send('ui.dialog.close', id ? { id } : {});
  }

  // ── external apps (session-only host configuration) ───────────────────────
  /** Declaratively set the SESSION-ONLY host-managed external apps: replaces
   *  any prior host-set entries with `apps` (user-configured Settings entries
   *  are untouched). Entries appear in the External ribbon; their origins get
   *  postMessage API access for this session. Nothing is persisted — a reload
   *  drops them until the host calls this again after `app.ready`, so a viewer
   *  opened without its host has none. `openOnStart: true` opens that entry
   *  immediately (panels/modals only — new-window entries are popup-blocked
   *  without a user gesture); a modal opened that way reports its `dialogId`,
   *  which `uiDialogHide` / `uiDialogShow` / `uiDialogClose` address. Call
   *  with `[]` to clear the host-set entries. */
  externalAppsSet(
    apps: HostExternalApp[],
  ): Promise<Result<{ apps: { id: string; name: string; url: string; dialogId?: string }[]; opened: number }>> {
    return this.send('externalApps.set', { apps });
  }

  /** List every configured external app — user-configured (Settings) and
   *  host-set session entries alike, told apart by `hostManaged`. */
  externalAppsList(): Promise<Result<{ apps: ExternalAppInfo[] }>> {
    return this.send('externalApps.list', {});
  }

  /** Delete databases by their OPFS `path` (from `sqlList`). A path in use by a
   *  running query (or another tab) is skipped, not waited on. */
  sqlDelete(paths: string[]): Promise<Result<{ deleted: string[]; skipped: string[] }>> {
    return this.send('sql.delete', { paths });
  }

  /** Run SQL against `mainDb` (a path from `sqlList`). ATTACH other databases
   *  inline with their OPFS path and they are locked automatically. `lockmode`
   *  defaults to 'shared' (read-only, several readers at once); pass
   *  'exclusive' to write. Rows per statement are capped at `maxRows` (default
   *  10000; a cut statement carries `truncated: true`). Results come back one
   *  entry per statement, in order. */
  sqlQuery(input: {
    sql: string;
    mainDb: string;
    lockmode?: 'shared' | 'exclusive';
    maxRows?: number;
  }): Promise<Result<SqlQueryResult>> {
    return this.send('sql.query', { ...input }, { timeoutMs: this.importTimeoutMs });
  }

  /**
   * Colour the model FROM a query — the SQL editor's Color White / Hidden /
   * Set buttons, over the API. The query must return a `fullname` column and
   * may return `fullname_color` (`'#ff0000'`, `'yellow'`, `'default'`, with an
   * optional `:opacity` suffix); rows without one get yellow.
   *
   * Nothing but the counts crosses the boundary: the viewer packs the result
   * inside its SQL worker and hands it to the model DB as flat buffers, so
   * this is the form to use for million-row results — `sqlQuery` + a colour
   * rule would ship every name to your page and back.
   *
   * `mode` picks the treatment — see {@link ColorMode}: the viewer's own
   * white / hidden / transparent / set-colour base coats, or your own colour
   * and rule set. Defaults to `{ type: 'default-white' }`.
   */
  sqlColor(
    input: SqlRunInput & { mode?: ColorMode; onProgress?: (p: { rows: number }) => void },
  ): Promise<Result<SqlColorResult>> {
    const { onProgress, ...rest } = input;
    const { payload, done } = this.progressFor('sql.color:progress', rest, onProgress);
    return this.send<SqlColorResult>('sql.color', payload, { timeoutMs: this.importTimeoutMs }).finally(done);
  }

  /** Select what a query returns (its `fullname` column), through the same
   *  packed path as {@link sqlColor} — the rows never reach your page.
   *  `append` adds to the current selection instead of replacing it. */
  sqlSelect(
    input: SqlRunInput & { append?: boolean; onProgress?: (p: { rows: number }) => void },
  ): Promise<Result<SqlSelectResult>> {
    const { onProgress, ...rest } = input;
    const { payload, done } = this.progressFor('sql.select:progress', rest, onProgress);
    return this.send<SqlSelectResult>('sql.select', payload, { timeoutMs: this.importTimeoutMs }).finally(done);
  }

  /** Run a query and show it in the viewer's SQL Table panel (`loadAll` lifts
   *  the 50-row preview cap to 250k). The rows land in the panel, not in the
   *  response — you get the column names and the row count. `show: false`
   *  fills the panel without opening it. */
  sqlTable(
    input: SqlRunInput & { name?: string; loadAll?: boolean; show?: boolean },
  ): Promise<Result<{ columns: string[]; rows: number }>> {
    return this.send('sql.table', { ...input }, { timeoutMs: this.importTimeoutMs });
  }

  /**
   * Put SQL into the viewer's **SQL Editor** panel — for when the USER should
   * see, tweak and run a query rather than the host running it headless.
   * Nothing is executed.
   *
   * `replace` (default true) swaps the whole script; `false` appends the SQL
   * below what is there as a titled block:
   *
   * ```sql
   * -------------------------------------------------
   * -- daily defects
   * -------------------------------------------------
   *
   * select …
   * ```
   *
   * so several queries can be stacked for the user to run one by one. `name`
   * titles that block (default `sql`); passing one also titles a replacing
   * script. Any text selection is cleared, so the panel's run buttons act on
   * the whole script.
   *
   * `store` + `fileName` point the editor's Main db at a database without the
   * host building OPFS paths (`mainDb` takes a path directly, `''` = the
   * panel's "None — attach only"); omit them and the current pick stands.
   * `show: false` fills the panel without opening it.
   */
  sqlEditor(input: {
    sql: string;
    replace?: boolean;
    name?: string;
    store?: string;
    fileName?: string;
    mainDb?: string;
    show?: boolean;
  }): Promise<Result<{ replaced: boolean; mainDb: string; chars: number }>> {
    return this.send('sql.editor', { ...input });
  }

  /** Bind a query to a SQL Detail panel: every hierarchy click runs it against
   *  the clicked node — write it against TREE_VIEW_ARGS, e.g.
   *  `… where fullname in (select FULLNAME from TREE_VIEW_ARGS)`.
   *
   *  `name` is the panel's IDENTITY as well as its tab title: each distinct
   *  name gets its OWN detail panel, so several queries can follow the
   *  selection side by side, and calling again with a name already in use
   *  re-binds that panel instead of opening another. Without a name the
   *  viewer's built-in SQL Detail panel is used. `show: false` binds without
   *  opening the panel. `panel` in the response is the dock panel id — pass it
   *  to {@link uiShowPanel} / {@link uiHidePanel}.
   *
   *  `autoRemove` (default true) decides what CLOSING a named panel does:
   *  true deletes the panel and its query outright, false keeps it in the
   *  viewer's Panels list so reopening restores the query. The panel header
   *  carries the same switch (an Auto-remove / Keep button); OMIT the field
   *  when re-binding a query and whatever the user chose there stands — pass
   *  it only to set it. A layout change (kiosk, a layout slot) never counts as
   *  a close. The response reports the value in effect.
   *
   *  Named panels last for the viewer SESSION (like host-managed external
   *  apps): after a page reload, create them again. */
  sqlDetail(
    input: SqlRunInput & { name?: string; show?: boolean; autoRemove?: boolean },
  ): Promise<Result<{ bound: boolean; name: string; panel: string; autoRemove: boolean }>> {
    return this.send('sql.detail', { ...input });
  }

  /** Run a BATCH of statements against `mainDb` in ONE transaction, with the
   *  full per-statement contract: bindings (bulk rows step a prepared
   *  statement), `collect` per statement, names for readable results. The
   *  whole batch commits or rolls back together (with `lockmode: 'exclusive'`;
   *  'shared' is read-only). `attach` lists extra database paths to lock; any
   *  `ATTACH DATABASE '…'` literal in a statement is locked automatically as
   *  well. `onProgress` gets a tick per finished statement and every
   *  `progressSize` (default 1000) rows — use it for long loads. Same row cap
   *  rules as `sqlQuery`. */
  sqlExecute(input: {
    mainDb: string;
    statements: SqlStatementInput[];
    attach?: string[];
    lockmode?: 'shared' | 'exclusive';
    maxRows?: number;
    /** rows between `row` ticks (default 1000); smaller = more ticks, slower */
    progressSize?: number;
    onProgress?: (p: SqlExecuteProgress) => void;
  }): Promise<Result<SqlExecuteResult>> {
    const { onProgress, ...rest } = input;
    const { payload, done } = this.progressFor('sql.execute:progress', rest, onProgress);
    return this.send<SqlExecuteResult>('sql.execute', payload, { timeoutMs: this.importTimeoutMs }).finally(done);
  }

  /** Subscribe to one batch's ticks on `eventType` and tag the payload with
   *  the batch id + `progress: true`; `done` unsubscribes. */
  private progressFor<T>(
    eventType: string,
    payload: Record<string, unknown>,
    onProgress?: (p: T) => void,
  ): { payload: Record<string, unknown>; done: () => void } {
    if (!onProgress) {
      return { payload, done: () => undefined };
    }
    const batchId = `${this.idPrefix}-${eventType.replace(/[^a-z]/gi, '')}-${this.nextId++}`;
    const off = this.on(eventType, (p) => {
      const pr = p as T & { batchId?: string };
      if (pr.batchId === batchId) {
        onProgress(pr);
      }
    });
    return { payload: { ...payload, batchId, progress: true }, done: off };
  }

  /** Toggle kiosk mode (viewport only — panels hidden). Omit `on` to query
   *  the current state without changing it. */
  uiKiosk(on?: boolean): Promise<Result<{ kiosk: boolean }>> {
    return this.send('ui.kiosk', on === undefined ? {} : { on });
  }

  /** Set the viewer's colour theme, or omit `theme` to query the current one
   *  without changing it. Handy for keeping an embedded viewer in step with the
   *  host page's light/dark mode. */
  uiTheme(theme?: 'dark' | 'light'): Promise<Result<{ theme: 'dark' | 'light' }>> {
    return this.send('ui.theme', theme === undefined ? {} : { theme });
  }

  /** Ask the viewer to close the dialog/panel hosting THIS window (embedded
   *  external apps closing themselves, e.g. a project selector after pick). */
  uiClose(): Promise<Result<{ closed: boolean }>> {
    return this.send('ui.close', {});
  }

  /** Open / close a dock panel by id (e.g. 'hierarchy'). */
  uiShowPanel(panel: string): Promise<Result<{ shown: boolean }>> {
    return this.send('ui.showPanel', { panel });
  }
  /** Hide a dock panel by id (counterpart of {@link uiShowPanel}). */
  uiHidePanel(panel: string): Promise<Result<{ hidden: boolean }>> {
    return this.send('ui.hidePanel', { panel });
  }

  /** Show / hide the blocking loading overlay. `header` is the bold title line,
   *  `title` the message below it. */
  uiLoadingShow(opts?: { header?: string; title?: string }): Promise<Result<Record<string, never>>> {
    return this.send('ui.loading.show', { ...opts });
  }
  /** Hide the blocking loading overlay shown by {@link uiLoadingShow}. */
  uiLoadingHide(): Promise<Result<Record<string, never>>> {
    return this.send('ui.loading.hide', {});
  }

  /** Show a confirm dialog; resolves with the user's choice. */
  uiConfirm(opts: {
    question: string;
    header?: string;
    yes?: string;
    no?: string;
  }): Promise<Result<{ confirmed: boolean }>> {
    return this.send('ui.confirm', { ...opts });
  }

  /** Show an error dialog. `title` is the message, `header` the bold title. */
  uiError(opts: { title: string; header?: string }): Promise<Result<Record<string, never>>> {
    return this.send('ui.error', { ...opts });
  }

  /** Replace (default) or merge the viewer's shared instance data — one JSON
   *  object per viewer window, for cross-dialog coordination. Every host gets
   *  an `instance.changed` event afterwards. */
  instanceSet(
    data: Record<string, unknown>,
    opts?: { merge?: boolean },
  ): Promise<Result<{ data: Record<string, unknown> }>> {
    return this.send('instance.set', { data, merge: opts?.merge ?? false });
  }

  /** Read the viewer's shared instance data (see {@link instanceSet}). */
  instanceGet(): Promise<Result<{ data: Record<string, unknown> }>> {
    return this.send('instance.get', {});
  }

  // ── unsolicited app → host events ─────────────────────────────────────────

  /** Listen for an app event (`id: null` messages) — the event types are
   *  listed in the file header ("EVENTS"). Returns an unsubscribe function. */
  on(type: string, handler: (payload: unknown) => void, opts?: SubscribeOptions): () => void {
    if (opts?.signal?.aborted) {
      return () => undefined; // never subscribed — same as addEventListener
    }
    let set = this.eventHandlers.get(type);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(type, set);
    }
    set.add(handler);
    const off = () => void set.delete(handler);
    opts?.signal?.addEventListener('abort', off, { once: true });
    return off;
  }

  /** Typed convenience for the tree-click event. */
  onTreeSelect(handler: (e: TreeSelectEvent) => void, opts?: SubscribeOptions): () => void {
    return this.on('tree.select', (p) => handler(p as TreeSelectEvent), opts);
  }

  /** Typed convenience for viewer theme changes — fired whichever way the
   *  theme switched (Settings tab, hotkey, `uiTheme`, or another tab syncing
   *  its settings over), so a host page and every embedded app can restyle in
   *  step with the viewer. */
  onThemeChanged(handler: (e: { theme: 'dark' | 'light' }) => void, opts?: SubscribeOptions): () => void {
    return this.on('theme.changed', (p) => handler(p as { theme: 'dark' | 'light' }), opts);
  }

  /** Typed convenience for instance-data changes (any dialog called instance.set). */
  onInstanceChanged(handler: (e: { data: Record<string, unknown> }) => void, opts?: SubscribeOptions): () => void {
    return this.on('instance.changed', (p) => handler(p as { data: Record<string, unknown> }), opts);
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private send<T>(
    type: string,
    payload: Record<string, unknown>,
    extra?: { bytes?: ArrayBuffer | Blob; timeoutMs?: number },
  ): Promise<Result<T>> {
    const target = this.target;
    if (!target) {
      return Promise.resolve({ error: { code: 'transport', msg: 'client disposed (no viewer window)' } });
    }
    const id = `${this.idPrefix}-${this.nextId++}`;
    const timeoutMs = extra?.timeoutMs ?? this.timeoutMs;
    return new Promise<Result<T>>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: { code: 'timeout', msg: `${type} timed out after ${timeoutMs} ms` } });
      }, timeoutMs);
      this.pending.set(id, { settle: resolve as (r: Result<unknown>) => void, timer });
      const msg: Record<string, unknown> = { tredespace: TREDESPACE_PROTOCOL, id, type, payload };
      if (extra?.bytes !== undefined) {
        msg.bytes = extra.bytes;
        // ArrayBuffer -> transferred (zero-copy, detached in the host). A
        // Blob/File is passed by structured clone (by reference, no big
        // allocation). Both are plain postMessage, so cross-origin embedding
        // is unaffected.
        if (extra.bytes instanceof ArrayBuffer) {
          target.postMessage(msg, this.origin, [extra.bytes]);
        } else {
          target.postMessage(msg, this.origin);
        }
      } else {
        target.postMessage(msg, this.origin);
      }
    });
  }

  private handle(e: MessageEvent) {
    if (this.origin !== '*' && e.origin !== this.origin) {
      return;
    }
    const d = e.data as {
      tredespace?: number;
      id?: string | null;
      type?: string;
      ok?: boolean;
      payload?: unknown;
      error?: { code: TredespaceErrorCode; message: string };
    };
    if (d?.tredespace !== TREDESPACE_PROTOCOL || typeof d.type !== 'string') {
      return;
    }
    if (d.type === 'app.ready') {
      this.readyPayload = d.payload as AppReady;
      for (const w of this.readyWaiters) {
        w(this.readyPayload);
      }
      this.readyWaiters = [];
      return;
    }
    if (!d.id) {
      // unsolicited app → host event (id: null), e.g. tree.select
      const handlers = this.eventHandlers.get(d.type);
      if (handlers) {
        for (const h of [...handlers]) {
          h(d.payload);
        }
      }
      return;
    }
    const p = this.pending.get(d.id);
    if (!p) {
      return;
    }
    this.pending.delete(d.id);
    clearTimeout(p.timer);
    if (d.ok) {
      p.settle({ data: d.payload });
    } else {
      const wire = d.error ?? { code: 'internal' as const, message: 'unknown error' };
      p.settle({ error: { code: wire.code, msg: wire.message, err: wire } });
    }
  }
}
