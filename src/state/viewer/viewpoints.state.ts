// Viewpoints: named snapshots of camera + clipping + labels + measurements +
// color rules + a fullname selection, activated for review/presentation.
//
// Mute model (the director's design): the SCENE and the ACTIVE VIEWPOINT each
// own their labels/measurements. The live stores (which the overlays render)
// hold whichever side is unmuted — `liveSide` says which. Activating a
// viewpoint stashes the scene sets and loads the viewpoint's; unmuting the
// scene swaps back. Edits stick ONLY via the explicit Save-to-viewpoint button
// (unsaved edits prompt on switch/unmute). Set Color has no mute: the
// viewpoint's rules are a separate store bound to the same editor component,
// and activation simply runs them.

import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { ColorRule } from '../../components/panels/multi-color/multiColor.state';
import { emptyMultiColorState } from '../../components/panels/multi-color/multiColor.state';
import type { RibbonClippingPlaneState } from '../../components/panels/ribbon-clipping-plane/ribbonClippingPlane.state';
import type { ClipShape } from './clipShapes.state';
import type { SceneLabel } from './labels.state';
import type { Measurement } from './measurements.state';

export interface ViewpointCamera {
  target: [number, number, number];
  azimuth: number;
  elevation: number;
  orbitDistance: number;
  orthographic: boolean;
  /** Sketch mode on/off. Optional: viewpoints saved before this field existed
   *  leave the current mode untouched on activation. */
  sketch?: boolean;
}

/** The geometry-relevant subset of the ribbon clipping box. */
export interface ViewpointClipBox {
  enabled: boolean;
  boxOn: boolean;
  center: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number, number];
  inverted: boolean;
}

export interface Viewpoint {
  id: string;
  name: string;
  /** Free text — rendered with **bold** + newlines (richTextHtml). */
  description: string;
  camera: ViewpointCamera;
  clipBox: ViewpointClipBox;
  /** The x/y/z clipping planes (whole ribbon state). Optional: viewpoints
   *  saved before this field existed simply leave the planes untouched. */
  clipPlanes?: RibbonClippingPlaneState;
  clipShapes: ClipShape[];
  labels: SceneLabel[];
  measurements: Measurement[];
  colorRules: { mode: 'reset' | 'append' | 'hide'; rules: ColorRule[] };
  /** Item fullnames selected when the viewpoint activates (one per line UI). */
  fullnames: string[];
}

export interface ViewpointsState {
  list: Viewpoint[];
  /** Viewpoint whose labels/measurements/rules are the editing context. */
  activeId: string | null;
  /** Which side's labels/measurements occupy the live stores right now. */
  liveSide: 'scene' | 'viewpoint';
  /** Scene labels/measurements parked while a viewpoint is live. */
  stash: { labels: SceneLabel[]; measurements: Measurement[] } | null;
  /** Row expanded in the Viewpoints panel editor. */
  selectedId: string | null;
  /** The "(viewpoint)" editor bars' Edit → Save flow: false shows Edit,
   *  true shows Save-to-viewpoint (lit while there are unsaved edits). */
  editing: boolean;
}

// Deliberately NOT persisted: viewpoints are tied to the loaded MODEL
// (fullnames, positions, rules), and a refresh may load a different one — the
// session always starts clean. Keeping a set is what Save…/Load… (JSON file)
// is for.
export const viewpointsState = createStore<ViewpointsState>({
  list: [],
  activeId: null,
  liveSide: 'scene',
  stash: null,
  selectedId: null,
  editing: false,
});

/** The ACTIVE viewpoint's Set Color rules — bound to the same editor component
 *  as the global Set Color panel (see MultiColorProvider). Synced with the
 *  active viewpoint record by viewpoints.actions. */
export const viewpointRulesState = createStore(emptyMultiColorState());
