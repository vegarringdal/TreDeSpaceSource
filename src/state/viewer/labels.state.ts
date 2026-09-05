import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { SphereMarker } from './sphereMarker';

/** A world-anchored text label. `offset` is the screen-px displacement from
 *  the anchor after dragging — non-zero draws a leader line back to it. */
export interface SceneLabel {
  id: number;
  /** shown text — with rich mode, supports multiline and **bold** spans */
  text: string;
  /** linked model fullname (tag import); null for hand-placed labels */
  fullname: string | null;
  anchor: [number, number, number];
  offset: [number, number];
  selected: boolean;
  /** per-label mute (Mute sel.) — hidden in the viewport, item kept */
  muted?: boolean;
  bg: string;
  opacity: number;
  textColor: string;
  /** 3D wireframe sphere at the anchor, depth tested — null/absent = none */
  sphere?: SphereMarker | null;
}

export const MAX_LABELS = 200;
export const LABEL_UNDO_MAX = 25;

export interface LabelsState {
  items: SceneLabel[];
  /** hide every label in the viewport (viewer/presentation mute) */
  muted: boolean;
  /** armed: the next viewport click places a new label */
  placing: boolean;
  /** armed: the next viewport click moves THIS label's anchor, then disarms */
  repositionId: number | null;
  /** enable multiline + **bold** editing (default simple single-line) */
  richText: boolean;
  /** tag import: when the subtree's box center lies in empty air (bent pipe
   *  runs), snap the anchor to the nearest child item instead */
  snapToItem: boolean;
  /** tag import: resolve tags only among models loaded from this store
   *  ('' = all stores) — guards against same-named models across stores */
  importStore: string;
  /** style applied to newly created labels AND to the current selection */
  bg: string;
  opacity: number;
  textColor: string;
  /** sphere marker for new labels / the selection; null = none */
  sphere: SphereMarker | null;
  leaderColor: string;
  /** explode layout shape + how many times explode has been pressed */
  explodeShape: 'circle' | 'box';
  explodeStep: number;
  /** view (viewProj signature) the current explode was laid out for — pressing
   *  Explode again from the same view grows it; a changed view starts fresh. */
  explodeView: string | null;
  undoDepth: number;
  redoDepth: number;
  /** bumped on every mutation so the overlay rebuilds its DOM */
  version: number;
}

export const labelsState = createStore<LabelsState>({
  items: [],
  muted: false,
  placing: false,
  repositionId: null,
  richText: false,
  snapToItem: false,
  importStore: '',
  bg: '#ffffff',
  opacity: 1,
  textColor: '#14161a',
  sphere: null,
  leaderColor: '#000000',
  explodeShape: 'circle',
  explodeStep: 0,
  explodeView: null,
  undoDepth: 0,
  redoDepth: 0,
  version: 0,
});
