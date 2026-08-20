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
// Usage:
//   const client = new TredespaceClient(iframe, { targetOrigin: 'https://viewer.example.com' });
//   await client.ready();
//   const res = await client.selectionSet(['/TP400-PIPE-01']);
//   if (res.error) console.warn(res.error.msg);
//   else console.log(res.data.matched, res.data.missed);
//   client.dispose();

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
  count: number;
  /** selection roots as fullnames */
  fullnames: string[];
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
   *  wildcard (equals, * anywhere) | multi (one name per line) */
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

export interface ColorRulesResult {
  rules: number;
  ran: boolean;
  matches: number[];
}

export interface SettingsGetResult {
  version: string;
  /** the persisted viewer-settings snapshot (read-only) */
  viewer: Record<string, unknown>;
}

export interface AssetInfo {
  id: string;
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
  count: number;
}

export type ImportFormat = 'glb-merged' | 'glb-standard' | 'rvm' | 'ifc' | 'step';

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
export interface ImportUrlProgress {
  completed: number;
  total: number;
  url: string;
  phase: 'download' | 'convert' | 'done' | 'error';
}

/** One SQLite database in OPFS (`sql_assets/<store>/<file>`). Stores are shared
 *  with model assets. `path` is what you pass as `mainDb` to `sqlQuery`, and
 *  what an ATTACH string literal references. */
export interface SqlDbInfo {
  store: string;
  fileName: string;
  path: string;
  size: number;
  modified: number;
}

export interface SqlImportResult {
  /** OPFS paths of the databases written. */
  imported: string[];
  /** file names skipped — already existed without `replace`, or the file was locked. */
  skipped: string[];
  /** how many existing databases were overwritten. */
  replaced: number;
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

/** Unsolicited `tree.select` event: the user clicked a row in the tree view. */
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

export interface TredespaceClientOptions {
  /** The viewer's origin, e.g. 'https://viewer.example.com'. Required. */
  targetOrigin: string;
  /** Per-command timeout (ms). Imports use importTimeoutMs. Default 30 000. */
  timeoutMs?: number;
  /** Timeout for assets.import (conversions can be long). Default 600 000. */
  importTimeoutMs?: number;
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
   *  `missed` lists fullnames that resolved to nothing. */
  selectionSet(fullnames: string[]): Promise<Result<SelectionSetResult>> {
    return this.send('selection.set', { fullnames });
  }
  /** Clear the current selection. */
  selectionClear(): Promise<Result<Record<string, never>>> {
    return this.send('selection.clear', {});
  }
  /** Read the current selection roots as fullnames. */
  selectionGet(): Promise<Result<SelectionGetResult>> {
    return this.send('selection.get', {});
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

  // ── clipping box + shapes ─────────────────────────────────────────────────
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
   *  just flies). `matched` is false when the fullname isn't found. */
  navFlyTo(fullname: string, opts?: { select?: boolean }): Promise<Result<{ matched: boolean }>> {
    return this.send('nav.flyTo', { fullname, select: opts?.select ?? false });
  }
  /** Set the orbit pivot to a node by fullname (camera stays); `select` also
   *  selects it. `matched` is false when the fullname isn't found. */
  navOrbit(fullname: string, opts?: { select?: boolean }): Promise<Result<{ matched: boolean }>> {
    return this.send('nav.orbit', { fullname, select: opts?.select ?? false });
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
    input: Parameters<TredespaceClient['assetsImport']>[0] & { fit?: boolean },
  ): Promise<Result<AssetsImportResult & { loaded: number }>> {
    const { fit, ...imp } = input;
    const res = await this.assetsImport(imp);
    if (res.error) {
      return { error: res.error };
    }
    const data = res.data as AssetsImportResult;
    const ids = data.entries.map((e) => e.id);
    let loaded = 0;
    if (ids.length) {
      const lr = await this.assetsLoad(ids, { fit: fit ?? true, ...(input.store ? { store: input.store } : {}) });
      if (lr.error) {
        return { error: lr.error };
      }
      loaded = (lr.data as { loaded: number }).loaded;
    }
    return { data: { ...data, loaded } };
  }

  /** Batch-import files the VIEWER downloads by URL — no bytes cross
   *  postMessage. Each file names its own `format` (required — a `.glb` URL is
   *  ambiguous). The viewer fetches up to `concurrent` files at once but cooks
   *  them ONE at a time (the importer is single-locked), so `concurrent` is
   *  really download parallelism — keep it modest for large RVM/IFC/STEP.
   *
   *  One `results` entry per input file, in order; a download or convert
   *  failure is recorded there and never aborts the batch. `onProgress` fires
   *  per phase change while the batch runs. URLs are fetched under the VIEWER
   *  origin's CORS, not the host's. */
  assetsImportUrl(
    files: ImportUrlFile[],
    opts?: {
      /** how many downloads run at once (default 3, clamped 1..8 by the viewer). */
      concurrent?: number;
      /** destination store (default 'main'); must be a known store name. */
      store?: string;
      /** delete any prior asset sharing each new one's store + folder + name. */
      replace?: boolean;
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

  /** Render imported assets into the viewer. `fit:true` (default) frames them.
   *  Pair with {@link assetsImport}, or use {@link assetsImportAndLoad}. */
  assetsLoad(ids: string[], opts?: { fit?: boolean; store?: string }): Promise<Result<{ loaded: number }>> {
    return this.send('assets.load', { ids, fit: opts?.fit ?? true, ...(opts?.store ? { store: opts.store } : {}) });
  }
  /** Remove assets from the viewport (they stay in the asset manager). */
  assetsUnload(ids: string[]): Promise<Result<{ unloaded: number }>> {
    return this.send('assets.unload', { ids });
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
   *  (the OPFS VFS is shm-less, so WAL can't be read shared). */
  sqlImport(input: {
    fileName: string;
    bytes: ArrayBuffer | Blob;
    /** destination store (default 'main'); must be a known store name */
    store?: string;
    replace?: boolean;
  }): Promise<Result<SqlImportResult>> {
    const { bytes, ...payload } = input;
    // A picked File must be read HERE and transferred — a File reference does
    // not survive postMessage into the viewer (NotReadableError otherwise).
    if (bytes instanceof Blob) {
      return bytes
        .arrayBuffer()
        .then((buf) =>
          this.send<SqlImportResult>('sql.import', payload, { bytes: buf, timeoutMs: this.importTimeoutMs }),
        );
    }
    return this.send<SqlImportResult>('sql.import', payload, { bytes, timeoutMs: this.importTimeoutMs });
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

  /** Listen for an app event (`id: null` messages, e.g. 'tree.select').
   *  Returns an unsubscribe function. */
  on(type: string, handler: (payload: unknown) => void): () => void {
    let set = this.eventHandlers.get(type);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(type, set);
    }
    set.add(handler);
    return () => void set.delete(handler);
  }

  /** Typed convenience for the tree-click event. */
  onTreeSelect(handler: (e: TreeSelectEvent) => void): () => void {
    return this.on('tree.select', (p) => handler(p as TreeSelectEvent));
  }

  /** Typed convenience for instance-data changes (any dialog called instance.set). */
  onInstanceChanged(handler: (e: { data: Record<string, unknown> }) => void): () => void {
    return this.on('instance.changed', (p) => handler(p as { data: Record<string, unknown> }));
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
