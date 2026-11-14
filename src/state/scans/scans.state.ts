import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { PanoMode } from '../../lib/render/panoPass';
import type { PointColorMode } from '../../lib/render/pointsLayer';
import { DEFAULT_OFFSET_STEP } from './offsetStep';

/** A loaded laser-scan asset (.tdpp). */
export interface ScanAssetView {
  readonly assetId: string;
  readonly name: string;
  readonly pointCount: number;
  readonly setupCount: number;
  /** Where the scan is moved from its own coordinates, metres (x, y, z). */
  readonly offset: readonly [number, number, number];
  /** The coordinate systems the scan can be shown in (names; '' = the
   *  source's own frame). Fewer than two = nothing to choose. */
  readonly systems: readonly string[];
  /** The one shown now. */
  readonly system: string;
}

/** One scanner setup of a loaded scan asset. */
export interface ScanSetupView {
  /** `<assetId>:<setup index>` — stable across selection / entering. */
  readonly key: string;
  readonly assetId: string;
  readonly setup: number;
  readonly name: string;
  readonly label: string;
  /** Scanner position (absolute, the scan's frame). */
  readonly position: readonly [number, number, number];
  readonly hasPanorama: boolean;
}

export interface ScansState {
  readonly assets: readonly ScanAssetView[];
  readonly setups: readonly ScanSetupView[];
  /** Loaded scans switched off in the Scans panel (asset ids): their points
   *  and setup spheres are not drawn. */
  readonly hidden: readonly string[];
  /** Loaded scans whose section in the Scans panel is folded away (asset
   *  ids) — only the header shows. */
  readonly folded: readonly string[];
  /** Highlighted setup (list / marker click). */
  readonly selected: string | null;
  /** Entered setup: camera pinned there, panorama shown. */
  readonly active: string | null;
  /** Panorama opacity, percent. */
  readonly opacity: number;
  /** 'over' (default): the photo covers model and points at the opacity;
   *  'background': only where nothing is drawn (points count as drawn). */
  readonly mode: PanoMode;
  readonly showMarkers: boolean;
  /** Opacity of the setup marker spheres, percent (10–100). */
  readonly markerOpacity: number;
  /** Fetching / decoding a panorama. */
  readonly busy: boolean;
  /** Stream and draw the point clouds. */
  readonly showPoints: boolean;
  /** Point size, CSS px (the smallest size when adaptive). */
  readonly pointSize: number;
  /** Most points drawn at once, millions. */
  readonly pointBudget: number;
  readonly colorMode: PointColorMode;
  /** Grow points to their level's spacing up close (no gaps). */
  readonly adaptive: boolean;
  /** Points farther from the camera than this are neither streamed nor
   *  drawn, metres (0 = no limit). */
  readonly pointMaxDistance: number;
  /** Beyond this distance the point detail falls off, metres (0 = even
   *  detail on screen): the budget goes to the near surroundings first. */
  readonly pointFocusDistance: number;
  /** The budget counts only the points inside the view (parts of large
   *  nodes outside it are free): finer detail, more memory. */
  readonly pointInViewBudget: boolean;
  /** How fine the points are loaded: 1 = until they sit about one point
   *  size apart on screen; 2 = twice as close (four times the points on a
   *  surface), and so on — as far as the budget allows. */
  readonly pointDetail: number;
  /** Points kept in memory beyond the budget for moving back without a
   *  reload, percent of the budget. */
  readonly pointCache: number;
  /** Inside a setup, draw only the points that setup measured. */
  readonly onlySetupPoints: boolean;
  /** How far one − / + of a scan's offset boxes (and their hotkeys) moves
   *  it, metres. */
  readonly offsetStep: number;
}

export const scansState = createStore<ScansState>({
  assets: [],
  setups: [],
  hidden: [],
  folded: [],
  selected: null,
  active: null,
  opacity: 100,
  mode: 'over',
  showMarkers: true,
  markerOpacity: 100,
  busy: false,
  showPoints: true,
  pointSize: 1,
  pointBudget: 5,
  colorMode: 'rgb',
  adaptive: false,
  pointMaxDistance: 0,
  pointFocusDistance: 0,
  pointInViewBudget: true,
  pointDetail: 1,
  pointCache: 50,
  onlySetupPoints: false,
  offsetStep: DEFAULT_OFFSET_STEP,
});
