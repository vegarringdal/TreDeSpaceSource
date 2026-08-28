import { createStore } from '@treDeSpaceUI/lib/createStore';

/** One imported model asset — the file lives in OPFS
 *  `model_assets/<store>/<id>.tdp`; this metadata lives in
 *  `model_assets/index.json` (survives refreshes). The store list itself is
 *  shared with SQL Assets — see state/stores/stores.state.ts. */
/** Cook-time boxes [minX,minY,minZ,maxX,maxY,maxZ] — dense = 10th–90th pct. */
export interface AssetBounds {
  full: number[];
  dense: number[] | null;
}

export interface AssetEntry {
  /** Host metadata attached at import (`meta` on the import command) and
   *  returned by `assets.list` — e.g. the md5 of the COMPRESSED artifact the
   *  host serves, for its own freshness checks. Opaque to the viewer; a
   *  converter that yields several assets from one file tags them all. */
  meta?: Record<string, unknown>;

  id: string;
  /** Which store this asset belongs to (default 'main'). */
  store: string;
  /** Display name in the assets list (renamable). */
  name: string;
  /** Grouping folder in the list ('' = ungrouped). */
  folder: string;
  /** The original file name (kept for reference + load labeling). */
  fileName: string;
  /** MD5 of the source bytes (RVM/IFC/STEP: the converted GLB) — lets a host
   *  detect whether re-importing would change anything. */
  md5?: string;
  size: number;
  importedAt: number;
  /** Captured at import (v8 cooker) — drives fit-to-loaded-selection. */
  bounds?: AssetBounds;
  /** merged = rvm2glb web3dversion-2; standard = generic glTF (incl. gpu-instanced). */
  kind?: 'merged' | 'standard';
  /** The cooked file carries an authored-normal stream (smooth shading). */
  hasNormals?: boolean;
  /** Draw edge lines on this model (undefined = true). Import option — off
   *  for meshes where edges would fight the surface (e.g. future textures). */
  edges?: boolean;
  /** A coarse geometry variant (`<id>.coarse.tdp`) exists for the VRAM-budget
   *  residency swap. Absent on pre-feature imports → demotion falls back to a
   *  full unload. */
  coarse?: { size: number };
  /** Session-only import (Import Manager "Temp" checkbox): the asset and its
   *  cooked file are purged on the next app start. */
  temp?: boolean;
}

/** The model DB's group = the import folder, or the model name when there's no
 *  folder (mirrors modeldb `addModel(group = name)`). Groups are treated as
 *  '/'-separated folder PATHS, but a merged GLB's hierarchy root name is stored
 *  verbatim WITH its leading '/' (e.g. "/HO-PIPE") — used raw as a group, that
 *  leading slash fabricates a blank top folder and shifts the rebuilt path so
 *  it no longer matches the stored group (the roots then never render). Strip
 *  leading slashes so the group is a clean path; the node NAME keeps its '/'. */
export const groupOf = (a: { folder: string; name: string }): string => (a.folder || a.name).replace(/^\/+/, '');

export interface AssetsState {
  /** Import destination store (Import Manager dropdown). '' = not chosen yet —
   *  kept (non-temp) imports require an explicit pick, no silent main. */
  importStore: string;
  assets: AssetEntry[];
  /** index.json has been read from OPFS. */
  ready: boolean;
  /** Import cook concurrency (worker pool, 1–10). */
  pool: number;
  /** Load concurrency for "Load selected" (1–10). */
  loadPool: number;
  /** Don't move the camera when loading additional models. */
  keepCamera: boolean;
  /** Load whatever an import produced into the viewer when it finishes. */
  loadAfterImport: boolean;
  /** Import as session-only temp (the DEFAULT): purged on next app start.
   *  Temp imports always load and ignore the store pick; keeping a file
   *  instead requires unticking this and choosing a store explicitly. */
  importTemp: boolean;
  /** Edge-triggered counters the library tree listens to (Collapse all /
   *  Expand all buttons and hotkeys) — the tree itself owns per-folder state. */
  treeCollapseSignal: number;
  treeExpandSignal: number;
  /** id → selected (multi-select for load/delete/rename-many later). */
  selected: Record<string, boolean>;
  /** Per-store folders that exist even while empty (store name → paths). */
  extraFolders: Record<string, string[]>;
  /** RVM import options (Import Manager → Import RVM). */
  rvm: RvmImportOptions;
  /** IFC import options (Import Manager → Import IFC). */
  ifc: IfcImportOptions;
  /** STEP import options (Import Manager → Import STEP). */
  step: StepImportOptions;
  /** Standard-GLB import options (Import Manager → Import standard GLB). */
  stdGlb: StdGlbImportOptions;
}

export interface StdGlbImportOptions {
  /** Keep authored normals (smooth shading). Off = flat shading, which also
   *  restores the full facet edge detection. */
  normals: boolean;
  /** Draw edge lines on this model when loaded (stored per asset). */
  edges: boolean;
}

export interface RvmImportOptions {
  /** Hierarchy split depth: 0 SITE, 1 ZONE, 2 EQUIPMENT. */
  level: number;
  /** Tessellation chord-height tolerance. */
  tolerance: number;
  includeLines: boolean;
  lineWidth: number;
  /** Round circle tessellation to multiples of 4 (better flat shading). */
  alignElements: boolean;
}

export interface IfcImportOptions {
  /** Split into one GLB per spatial tier: 'none' | 'site' | 'building' | 'storey'. */
  split: string;
  /** Tessellation quality: 'lowest' | 'low' | 'medium' | 'high' | 'highest'. */
  quality: string;
  /** IfcSpace handling: 'skip' | 'include' | 'separate'. */
  spaces: string;
  /** Opening (void) handling: 'skip' | 'include' | 'separate'. */
  openings: string;
  /** Recenter the model on its bounding box. */
  recenter: boolean;
}

export interface StepImportOptions {
  /** Chordal sag tolerance (mm) — smaller = smoother, more triangles. */
  deflectionMm: number;
  /** Max chord turn angle (deg) — smaller = smoother, more triangles. */
  maxAngleDeg: number;
  /** Weld positions (drops normals) — matches flatshaded rendering. */
  cleanup: boolean;
}

export const assetsState = createStore<AssetsState>({
  importStore: '',
  assets: [],
  ready: false,
  pool: 10,
  loadPool: 10,
  keepCamera: false,
  loadAfterImport: true,
  importTemp: true,
  treeCollapseSignal: 0,
  treeExpandSignal: 0,
  selected: {},
  extraFolders: {},
  rvm: { level: 0, tolerance: 0.01, includeLines: false, lineWidth: 0.005, alignElements: false },
  ifc: { split: 'none', quality: 'medium', spaces: 'skip', openings: 'skip', recenter: true },
  step: { deflectionMm: 1.0, maxAngleDeg: 25.0, cleanup: true },
  stdGlb: { normals: true, edges: true },
});
