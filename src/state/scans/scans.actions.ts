// Laser scans (.tdpp assets): open the file from OPFS (header, hierarchy and
// metadata only — points stream later), list the scanner setups, and drive
// the panorama view: entering a setup pins the camera at the scanner
// position and shows its cube photo (background or crossfaded over the
// model). The file handles live here, not in the store.
import { consoleActions } from '../../components/panels/console/console.actions';
import { modelStoreDir } from '../../lib/opfs/opfs';
import type { PanoMode } from '../../lib/render/panoPass';
import type { PointColorMode } from '../../lib/render/pointsLayer';
import type { Result } from '../../lib/result';
import { boxToScene } from '../../lib/tdpp/cloudFrame';
import { fileSystemName, placeTdpp, type ScanPlacement, SOURCE_FRAME } from '../../lib/tdpp/scanPlacement';
import { blobSource, openTdpp, type TdppFile, type TdppSetup, type TdppSource } from '../../lib/tdpp/tdppFormat';
import type { AssetEntry } from '../assets/assets.state';
import { getRenderer, viewerActions } from '../viewer/viewer.actions';
import { clampOffsetStep, nextOffsetStep } from './offsetStep';
import { type OpenScan, openScans } from './scanFiles';
import { type MarkerHit, type MarkerRay, pickScanMarker, type ScanMarker, scanMarkerInstances } from './scanMarkers';
import { scanPhoto } from './scanPhoto';
import { scanPoints } from './scanPoints';
import { type ScanSetupView, scansState } from './scans.state';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const OPACITY_STEP = 10;
const NO_OFFSET: readonly [number, number, number] = [0, 0, 0];
/** Lowest marker opacity, percent — below it they could not be found again. */
const MIN_MARKER_OPACITY = 10;
const POINT_SIZE_RANGE = [1, 10] as const;
/** Point budget range, millions. */
const POINT_BUDGET_RANGE = [1, 50] as const;
/** Max point distance, metres (0 = off). */
const POINT_DISTANCE_RANGE = [0, 2000] as const;
const POINT_DISTANCE_STEP = 10;
const POINT_FOCUS_RANGE = [0, 500] as const;
const POINT_FOCUS_STEP = 5;
/** Detail factor range and step (see ScansState.pointDetail). */
const POINT_DETAIL_RANGE = [0.5, 8] as const;
const POINT_DETAIL_STEP = 0.5;
const POINT_CACHE_RANGE = [0, 200] as const;
const POINT_CACHE_STEP = 25;

/** Bumped on every marker-relevant change; the viewport keys its upload on it. */
let markerVersion = 0;
let markerCache: { version: number; data: Float32Array } = { version: -1, data: new Float32Array(0) };
/** Bumped by every enter and exit: an enter still loading its photo when a
 *  later one (or an exit) arrives must not finish on top of it. */
let enterSeq = 0;

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

const fail = <T>(msg: string, err: unknown = null): Result<T> => ({ error: { err, msg } });

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Math.round(v)));

function bumpMarkers() {
  markerVersion++;
}

function setupViews(assetId: string, setups: readonly TdppSetup[]): ScanSetupView[] {
  return setups.map((s, i) => ({
    key: `${assetId}:${i}`,
    assetId,
    setup: i,
    name: s.name,
    label: s.label || s.name,
    position: [s.translation[0], s.translation[1], s.translation[2]],
    hasPanorama: s.faces !== null || s.sphere !== null,
  }));
}

/** The coordinate systems a scan can be shown in: its source's, plus the
 *  source's own frame when there is any to choose from. */
function systemChoices(file: TdppFile): string[] {
  const names = file.meta.coordinateSystems.map((c) => c.name);
  return names.length > 0 ? [...names, SOURCE_FRAME] : [];
}

/** A placed scan's bounds in scene coordinates (min xyz, max xyz). */
function placedBounds(file: TdppFile): number[] {
  const h = file.header;
  const box = boxToScene(file.meta.axes, h.boundsMin, h.boundsMax);
  return [0, 1, 2].map((k) => h.origin[k] + box.min[k]).concat([0, 1, 2].map((k) => h.origin[k] + box.max[k]));
}

/** The saved coordinate-system choice, when the file still has it: a scan
 *  converted again may list other systems than the one it replaced. */
function knownSystem(file: TdppFile, name: string | undefined): string | undefined {
  const known = name === SOURCE_FRAME || file.meta.coordinateSystems.some((c) => c.name === name);
  return name !== undefined && known ? name : undefined;
}

function findSetup(key: string): { scan: OpenScan; setup: TdppSetup; view: ScanSetupView } | null {
  const view = scansState.get().setups.find((s) => s.key === key);
  const scan = view ? openScans.get(view.assetId) : undefined;
  const setup = view && scan ? scan.file.meta.setups[view.setup] : undefined;
  return view && scan && setup ? { scan, setup, view } : null;
}

function applyPanoView() {
  const r = getRenderer();
  const s = scansState.get();
  const hit = s.active ? findSetup(s.active) : null;
  if (!r || !hit) {
    r?.photo.setView(null);
    return;
  }
  // a cube sits in the setup's frame, a spherical image in its own
  const rotation = hit.setup.faces ? hit.setup.rotation : (hit.setup.sphere?.rotation ?? hit.setup.rotation);
  r.photo.setView({ rotation, opacity: s.opacity / 100, mode: s.mode });
}

/** The setup `step` places from the current one in its scan (wrapping); a
 *  scan switched off in the panel has none to step to. */
function neighbour(step: number): string | null {
  const s = scansState.get();
  const current = s.active ?? s.selected;
  const shown = s.setups.filter((v) => !s.hidden.includes(v.assetId));
  const assetId = current ? current.split(':')[0] : shown[0]?.assetId;
  const list = shown.filter((v) => v.assetId === assetId);
  if (list.length === 0) {
    return null;
  }
  const at = list.findIndex((v) => v.key === current);
  return list[(at + step + list.length) % list.length].key;
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

export const scansActions = {
  /** Open a .tdpp asset from OPFS (metadata only) and list its setups. */
  async openAsset(entry: AssetEntry): Promise<Result<void>> {
    if (openScans.has(entry.id)) {
      return {};
    }
    let src: TdppSource;
    try {
      const dir = await modelStoreDir(entry.store);
      const handle = await dir.getFileHandle(`${entry.id}.tdpp`);
      src = blobSource(await handle.getFile());
    } catch (e) {
      return fail(`scan file missing for ${entry.name}`, e);
    }
    const f = await openTdpp(src);
    if (!f.data) {
      return { error: f.error };
    }
    const base = f.data;
    const system = knownSystem(base, entry.scanCoordSystem);
    if (system !== entry.scanCoordSystem) {
      consoleActions.log(
        'warn',
        `Scans: ${entry.name} no longer has the coordinate system "${entry.scanCoordSystem}" — shown in the one the file is in`,
      );
    }
    const placement = { system, offset: entry.scanOffset ?? NO_OFFSET };
    const file = placeTdpp(base, placement);
    openScans.set(entry.id, { name: entry.name, src, base, file });
    scansState.set((s) => ({
      assets: [
        ...s.assets,
        {
          assetId: entry.id,
          name: entry.name,
          pointCount: file.header.pointCount,
          setupCount: file.meta.setups.length,
          offset: placement.offset,
          systems: systemChoices(base),
          system: placement.system ?? fileSystemName(base),
        },
      ],
      setups: [...s.setups, ...setupViews(entry.id, file.meta.setups)],
    }));
    bumpMarkers();
    consoleActions.log(
      'info',
      `Scans: opened ${entry.name} — ${file.meta.setups.length} setup(s), ${file.header.pointCount.toLocaleString()} points, coordinates: ${file.meta.frame.replace(/ \(.*\)$/, '') || 'as stored'}`,
    );
    return {};
  },

  /** Place an open scan: the coordinate system it is shown in and its
   *  offset. The points, the setup spheres, the photo and — when the camera
   *  is inside one of its setups — the camera follow. Returns the placed
   *  bounds (min xyz, max xyz), or null when the scan is not open.
   *  Persisting the choice is the assets domain's job. */
  applyPlacement(assetId: string, placement: ScanPlacement): number[] | null {
    const scan = openScans.get(assetId);
    if (!scan) {
      return null;
    }
    scan.file = placeTdpp(scan.base, placement);
    scansState.set((s) => ({
      assets: s.assets.map((a) =>
        a.assetId === assetId
          ? { ...a, offset: placement.offset, system: placement.system ?? fileSystemName(scan.base) }
          : a,
      ),
      setups: [...s.setups.filter((v) => v.assetId !== assetId), ...setupViews(assetId, scan.file.meta.setups)],
    }));
    bumpMarkers();
    const r = getRenderer();
    if (r) {
      scanPoints.moved(r);
      const active = scansState.get().active;
      const inside = active?.startsWith(`${assetId}:`) ? findSetup(active) : null;
      if (inside) {
        r.camera.enterScan(inside.view.position);
        applyPanoView();
      }
    }
    return placedBounds(scan.file);
  },

  /** Where an open scan is drawn: its bounds (min xyz, max xyz) and the
   *  coordinate system it is shown in; null when it is not open. */
  placed(assetId: string): { readonly bounds: number[]; readonly system: string } | null {
    const scan = openScans.get(assetId);
    const view = scansState.get().assets.find((a) => a.assetId === assetId);
    return scan && view ? { bounds: placedBounds(scan.file), system: view.system } : null;
  },

  /** Close a scan asset (leaves its setup first when entered). */
  closeAsset(assetId: string) {
    const s = scansState.get();
    if (s.active?.startsWith(`${assetId}:`)) {
      scansActions.exit();
    }
    openScans.delete(assetId);
    scansState.set((st) => ({
      assets: st.assets.filter((a) => a.assetId !== assetId),
      setups: st.setups.filter((v) => v.assetId !== assetId),
      hidden: st.hidden.filter((id) => id !== assetId),
      folded: st.folded.filter((id) => id !== assetId),
      selected: st.selected?.startsWith(`${assetId}:`) ? null : st.selected,
    }));
    bumpMarkers();
  },

  /** Close every open scan (Home → Remove all). */
  closeAll() {
    for (const id of [...openScans.keys()]) {
      scansActions.closeAsset(id);
    }
  },

  /** Show / hide one loaded scan (points and setup spheres); it stays loaded.
   *  Hiding the scan the camera is inside leaves its setup first. */
  toggleScan(assetId: string) {
    const s = scansState.get();
    const hide = !s.hidden.includes(assetId);
    if (hide && s.active?.startsWith(`${assetId}:`)) {
      scansActions.exit();
    }
    scansState.set((st) => ({
      hidden: hide ? [...st.hidden, assetId] : st.hidden.filter((id) => id !== assetId),
    }));
    bumpMarkers();
  },

  /** Fold one scan's section in the Scans panel away, or open it. */
  toggleScanFolded(assetId: string) {
    scansState.set((st) => ({
      folded: st.folded.includes(assetId) ? st.folded.filter((id) => id !== assetId) : [...st.folded, assetId],
    }));
  },

  /** Fold every scan's section away: only the headers stay. */
  foldAllScans() {
    scansState.set((st) => ({ folded: st.assets.map((a) => a.assetId) }));
  },

  /** Open every scan's section. */
  expandAllScans() {
    scansState.set({ folded: [] });
  },

  /** The scan the hotkeys act on: the one of the entered or selected setup,
   *  else the only / first loaded one. */
  currentScan(): string | null {
    const s = scansState.get();
    const key = s.active ?? s.selected;
    return key ? key.split(':')[0] : (s.assets[0]?.assetId ?? null);
  },

  isOpen(assetId: string): boolean {
    return openScans.has(assetId);
  },

  select(key: string | null) {
    scansState.set({ selected: key });
    bumpMarkers();
  },

  /** Enter a setup (default: the selected one): camera pinned at the scanner,
   *  panorama faces decoded and uploaded. A later enter or an exit while the
   *  photo is still loading wins: this one then changes nothing. */
  async enter(key?: string): Promise<Result<void>> {
    const want = key ?? scansState.get().selected;
    const hit = want ? findSetup(want) : null;
    const r = getRenderer();
    if (!want || !hit || !r || scansState.get().hidden.includes(hit.view.assetId)) {
      return fail('no scan setup selected');
    }
    // a photo is a perspective view: the pinned eye has no extent in orthographic
    if (r.camera.ortho) {
      viewerActions.setProjection(false);
    }
    const mine = ++enterSeq;
    scansState.set({ busy: true, selected: want });
    try {
      await scanPhoto.show(r, hit.scan, hit.setup);
    } catch (e) {
      if (mine !== enterSeq) {
        return {};
      }
      scansState.set({ busy: false });
      consoleActions.log('error', `Scans: panorama of ${hit.view.label} failed: ${e}`);
      return fail(`panorama of ${hit.view.label} could not be read`, e);
    }
    if (mine !== enterSeq) {
      return {};
    }
    // the scan was closed, or the renderer replaced (device loss), meanwhile
    const now = findSetup(want);
    if (!now || getRenderer() !== r) {
      scanPhoto.clear(getRenderer());
      scansState.set({ busy: false });
      return fail(`${hit.view.label} is no longer loaded`);
    }
    r.camera.enterScan(now.view.position);
    scansState.set({ active: want, busy: false });
    applyPanoView();
    bumpMarkers();
    return {};
  },

  /** Leave the entered setup: free camera, panorama hidden. */
  exit() {
    enterSeq++;
    const r = getRenderer();
    r?.photo.setView(null);
    scanPhoto.clear(r);
    r?.camera.exitScan();
    scansState.set({ active: null, busy: false });
    bumpMarkers();
  },

  /** Next / previous setup of the current scan; enters it when one is entered. */
  async step(delta: 1 | -1): Promise<void> {
    const key = neighbour(delta);
    if (!key) {
      return;
    }
    if (scansState.get().active) {
      await scansActions.enter(key);
    } else {
      scansActions.select(key);
    }
  },

  setOpacity(percent: number) {
    scansState.set({ opacity: Math.min(100, Math.max(0, Math.round(percent))) });
    applyPanoView();
  },

  stepOpacity(direction: 1 | -1) {
    scansActions.setOpacity(scansState.get().opacity + direction * OPACITY_STEP);
  },

  /** Opacity of the setup marker spheres, percent — never fully invisible
   *  (hide them with the checkbox instead). */
  setMarkerOpacity(percent: number) {
    scansState.set({ markerOpacity: Math.min(100, Math.max(MIN_MARKER_OPACITY, Math.round(percent))) });
    bumpMarkers();
  },

  stepMarkerOpacity(direction: 1 | -1) {
    scansActions.setMarkerOpacity(scansState.get().markerOpacity + direction * OPACITY_STEP);
  },

  setMode(mode: PanoMode) {
    scansState.set({ mode });
    applyPanoView();
  },

  toggleMode() {
    scansActions.setMode(scansState.get().mode === 'background' ? 'over' : 'background');
  },

  toggleMarkers() {
    scansState.set((s) => ({ showMarkers: !s.showMarkers }));
    bumpMarkers();
  },

  togglePoints() {
    scansState.set((s) => ({ showPoints: !s.showPoints }));
  },

  setPointSize(px: number) {
    scansState.set({ pointSize: clamp(px, POINT_SIZE_RANGE) });
  },

  stepPointSize(direction: 1 | -1) {
    scansActions.setPointSize(scansState.get().pointSize + direction);
  },

  /** Most points drawn at once over every open scan, millions. */
  setPointBudget(millions: number) {
    scansState.set({ pointBudget: clamp(millions, POINT_BUDGET_RANGE) });
  },

  stepPointBudget(direction: 1 | -1) {
    scansActions.setPointBudget(scansState.get().pointBudget + direction);
  },

  setColorMode(colorMode: PointColorMode) {
    scansState.set({ colorMode });
  },

  toggleColorMode() {
    scansActions.setColorMode(scansState.get().colorMode === 'rgb' ? 'intensity' : 'rgb');
  },

  toggleAdaptive() {
    scansState.set((s) => ({ adaptive: !s.adaptive }));
  },

  /** Max distance of drawn points, metres (0 = no limit). */
  setPointMaxDistance(metres: number) {
    scansState.set({ pointMaxDistance: clamp(metres, POINT_DISTANCE_RANGE) });
  },

  stepPointMaxDistance(direction: 1 | -1) {
    scansActions.setPointMaxDistance(scansState.get().pointMaxDistance + direction * POINT_DISTANCE_STEP);
  },

  /** Distance beyond which point detail falls off, metres (0 = off). */
  setPointFocusDistance(metres: number) {
    scansState.set({ pointFocusDistance: clamp(metres, POINT_FOCUS_RANGE) });
  },

  stepPointFocusDistance(direction: 1 | -1) {
    scansActions.setPointFocusDistance(scansState.get().pointFocusDistance + direction * POINT_FOCUS_STEP);
  },

  togglePointInViewBudget() {
    scansState.set((s) => ({ pointInViewBudget: !s.pointInViewBudget }));
  },

  /** How fine the points are loaded (1 = one point size apart on screen). */
  setPointDetail(factor: number) {
    const [lo, hi] = POINT_DETAIL_RANGE;
    const stepped = Math.round(factor / POINT_DETAIL_STEP) * POINT_DETAIL_STEP;
    scansState.set({ pointDetail: Math.min(hi, Math.max(lo, stepped)) });
  },

  stepPointDetail(direction: 1 | -1) {
    scansActions.setPointDetail(scansState.get().pointDetail + direction * POINT_DETAIL_STEP);
  },

  /** Points kept beyond the budget, percent of it. */
  setPointCache(percent: number) {
    scansState.set({ pointCache: clamp(percent, POINT_CACHE_RANGE) });
  },

  stepPointCache(direction: 1 | -1) {
    scansActions.setPointCache(scansState.get().pointCache + direction * POINT_CACHE_STEP);
  },

  toggleOnlySetupPoints() {
    scansState.set((s) => ({ onlySetupPoints: !s.onlySetupPoints }));
  },

  /**
   * The step of the offset boxes, metres. A value of 0 or less is the step
   * box's own − pressed at a power of ten (0.1 − 0.1): that continues in the
   * decade below, like the hotkey.
   */
  setOffsetStep(metres: number) {
    const current = scansState.get().offsetStep;
    scansState.set({ offsetStep: metres > 0 ? clampOffsetStep(metres) : nextOffsetStep(current, -1) });
  },

  stepOffsetStep(direction: 1 | -1) {
    scansState.set((s) => ({ offsetStep: nextOffsetStep(s.offsetStep, direction) }));
  },

  /** Markers drawn now: every setup except the entered one (the camera sits
   *  inside it), none when hidden. */
  markers(): ScanMarker[] {
    const s = scansState.get();
    if (!s.showMarkers) {
      return [];
    }
    return s.setups
      .filter((v) => v.key !== s.active && !s.hidden.includes(v.assetId))
      .map((v) => ({ key: v.key, center: v.position, selected: v.key === s.selected }));
  },

  /** Marker-sphere instances + their upload key, rebuilt only on change;
   *  `opaque` tells the renderer which of its two blocks they belong in. */
  markerInstances(): { readonly data: Float32Array; readonly key: number; readonly opaque: boolean } {
    const alpha = scansState.get().markerOpacity / 100;
    if (markerCache.version !== markerVersion) {
      markerCache = { version: markerVersion, data: scanMarkerInstances(scansActions.markers(), alpha) };
    }
    return { data: markerCache.data, key: markerVersion, opaque: alpha >= 1 };
  },

  /** The setup marker under a picking ray, or null — none while a fully
   *  opaque photo covers the scene (the spheres are behind it). */
  pickMarker(ray: MarkerRay): MarkerHit | null {
    const s = scansState.get();
    if (s.active && s.mode === 'over' && s.opacity >= 100) {
      return null;
    }
    return pickScanMarker(ray, scansActions.markers());
  },
};
