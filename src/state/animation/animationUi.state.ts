import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { PivotChoice } from '../../lib/animation/pivots';
import type { Interp } from '../../lib/animation/types';
import type { KeyRow, RowId } from './rows';

/** Animation mode (DESIGN.md › Animation): off, playing back only (the
 *  host's play bar, presenting), or authoring in the Timeline. */
export type AnimationUiMode = { kind: 'off' } | { kind: 'playback' } | { kind: 'author' };

/** What the Key panel shows besides the current row. */
export type Picked =
  | { kind: 'none' }
  /** keys of one row (indices into its sorted keys) */
  | { kind: 'keys'; row: KeyRow; indices: number[] }
  | { kind: 'step'; id: string }
  /** a callout, and its picked position keys */
  | { kind: 'callout'; id: string; keys: number[] };

/** A pose not keyed yet: the objects drawn moved on top of the animation
 *  (the world-space matrices live in the runtime). */
export interface Posing {
  objects: string[];
  /** bumped on every pose change (the Key panel re-reads) */
  rev: number;
}

export interface AnimationUiState {
  mode: AnimationUiMode;
  /** the row Key keys: an object, the camera, the section, the colour rules
   *  or the steps */
  current: RowId | null;
  picked: Picked;
  posing: Posing | null;
  /** the objects whose items are selected (their Timeline rows highlight) */
  objectSelection: string[];
  /** the interpolation the next key gets (null = a key's own, else smooth);
   *  cleared after each Key */
  nextInterp: Interp | null;
  /** the pivot the next key gets (null = automatic: the own key's, the
   *  Transform ribbon's set pivot for a new key, else the key it inserts
   *  into); cleared after each Key */
  nextPivot: PivotChoice | null;
  /** timeline viewport: pixels per second and the left edge in seconds */
  view: { pxPerSec: number; offset: number };
  /** in / out range set with the ruler handles */
  range: { from: number; to: number } | null;
  snap: boolean;
  /** gizmo releases key at the time slider straight away */
  autoKey: boolean;
  /** motion paths drawn in the viewport */
  showPaths: boolean;
  /** the Timeline's name column width, px (persisted) */
  timelineLabelWidth: number;
  /** Set Color rules shown on the scene but not keyed yet (Set Color's Run) */
  previewRules: boolean;
  /** labels / measurements on screen changed but not keyed yet */
  previewLabels: boolean;
  previewMeasurements: boolean;
  /** the colour Colour from here keys */
  keyColor: string;
  /** Slide in: the side it comes from (a SLIDE_DIRECTIONS value), how far
   *  (m) and how long (s) */
  slideIn: { dir: string; distance: number; duration: number };
}

export const animationUiState = createStore<AnimationUiState>({
  mode: { kind: 'off' },
  current: null,
  picked: { kind: 'none' },
  posing: null,
  objectSelection: [],
  nextInterp: null,
  nextPivot: null,
  view: { pxPerSec: 60, offset: 0 },
  range: null,
  snap: true,
  autoKey: false,
  showPaths: true,
  timelineLabelWidth: 150,
  previewRules: false,
  previewLabels: false,
  previewMeasurements: false,
  keyColor: '#ef4444',
  slideIn: { dir: 'above', distance: 1, duration: 2 },
});
