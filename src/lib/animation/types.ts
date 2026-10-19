// -----------------------------------------------------------------------------
// animation document model, version 2 (DESIGN.md › Animation › Data model)
// -----------------------------------------------------------------------------
// Navisworks-style: a scene holds objects made from a selection, each with
// ONE row of keys, plus scene rows for the camera, the section (clipping),
// the colour rules, steps (named spans with a card) and callouts. Keys hold
// ABSOLUTE values — an object key is where the object stands (its offset
// from where it stands in the model), never a change from the key before.
// JSON-serializable; seconds, metres, rotations as quaternions (degrees only
// in the UI). Pure — no store imports, so the core modules unit-test.

import type { SceneLabel } from '../../state/viewer/labels.state';
import type { Measurement } from '../../state/viewer/measurements.state';
import type { ViewpointCamera } from '../../state/viewer/viewpoints.state';
import type {
  OverlayComponent,
  OverlayFx,
  OverlayInstance,
  OverlayTheme,
  OverlayValue,
  Pin,
} from '../overlay/overlayTypes';

// -----------------------------------------------------------------------------
// primitives
// -----------------------------------------------------------------------------

export type V2 = [number, number];
export type V3 = [number, number, number];
/** x y z w */
export type Quat = [number, number, number, number];

export type AnimCamera = ViewpointCamera;

/** How a value arrives at a key: smooth (eased in and out), linear, or
 *  hold (it stays where it was, then jumps at the key). */
export type Interp = 'smooth' | 'linear' | 'hold';

// -----------------------------------------------------------------------------
// objects
// -----------------------------------------------------------------------------

/** One key of an object row. */
export interface ObjectKey {
  /** seconds on the scene clock */
  t: number;
  /** offset from where the object stands in the model (m) */
  move: V3;
  /** rotation about the object's pivot */
  rotate: Quat;
  /** how the object arrives at this key */
  interp: Interp;
  /** whole turns on the way here (slerp alone cannot pass 180°) */
  spin?: { axis: V3; degrees: number };
  /** what `move` and `rotate` are about, and what the object turns about on
   *  the way here (its point travels straight); absent = the object's pivot */
  pivot?: KeyPivot;
  /** from this key on (instant); absent = as the key before */
  visible?: boolean;
  /** 0..1 from this key on (instant); absent = as the key before */
  opacity?: number;
  /** '#rrggbb' from this key on, null = the item's own colour; absent = as
   *  the key before */
  color?: string | null;
}

/** A side of an object's items' box where they stand in the model — centre,
 *  or the middle of a face (front = −Y, right = +X, top = +Z, like the view
 *  cube). */
export type PivotAnchor = 'center' | 'bottom' | 'top' | 'front' | 'back' | 'left' | 'right';

/** Where an object turns about: a point in the model, or a side of its
 *  items' box where they stand. */
export type ObjectPivot = V3 | PivotAnchor;

/** A key's own pivot: a side of the object's box or a point of the object
 *  where it stands in the model (a hinge), moved by `offset` (m). */
export interface KeyPivot {
  at: PivotAnchor | V3;
  offset?: V3;
}

/** straight = lines between keys; smooth = a curve through them */
export type MotionPath = 'straight' | 'smooth';

/** An animation set: items moved, shown, hidden and coloured together. */
export interface AnimObject {
  id: string;
  name: string;
  /** lower-cased fullnames; an item under a named node moves with it */
  items: string[];
  /** lower-cased fullnames left out (with what is under them) — a group
   *  minus a few; adds and leave-outs nest, the deeper one wins */
  exclude?: string[];
  pivot: ObjectPivot;
  path: MotionPath;
  /** sorted by time */
  keys: ObjectKey[];
  /** not animated (its items stand where they are in the model) */
  muted?: boolean;
}

// -----------------------------------------------------------------------------
// scene rows
// -----------------------------------------------------------------------------

export interface CameraKey {
  t: number;
  view: AnimCamera;
  /** hold = a cut at the key; smooth / linear = a glide from the key before */
  interp: Interp;
}

/** The clip box as a section key stores it (the viewpoint subset). */
export interface ClipBoxState {
  enabled: boolean;
  boxOn: boolean;
  center: V3;
  size: V3;
  rotation: Quat;
  inverted: boolean;
}

/** One clipping plane (x / y / z) as a section key stores it. */
export interface ClipPlaneState {
  enabled: boolean;
  position: number;
  /** elevation / azimuth (degrees) */
  el: number;
  az: number;
  flipped: boolean;
  anchor: V3 | null;
}

/** One clip shape as a section key stores it. */
export interface ClipShapeState {
  kind: 'sphere' | 'cylinder' | 'box';
  label: string;
  center: V3;
  axis: V3;
  radius: number;
  height: number;
  halfExtents: V3;
  rotation: Quat;
  enabled: boolean;
  inverted: boolean;
}

/** The whole clipping at a section key. */
export interface ClipStateValue {
  box: ClipBoxState;
  planes: { x: ClipPlaneState; y: ClipPlaneState; z: ClipPlaneState };
  shapes: ClipShapeState[];
}

export interface SectionKey {
  t: number;
  value: ClipStateValue;
  /** hold = switch at the key; smooth / linear = the box and planes glide */
  interp: Interp;
}

/** One Set Color filter row — the Set Color panel's FilterRow. */
export interface LookFilter {
  op: 'append' | 'remove' | 'keep';
  mode: 'contains' | 'single' | 'multi' | 'starts' | 'ends' | 'wildcard';
  value: string;
  comment: string;
  /** hierarchy level the row applies at (0 = any) */
  level: number;
}

/** One Set Color rule — structurally the Set Color panel's ColorRule, so a
 *  rule set moves between the panel, viewpoints and the animation unchanged. */
export interface LookRule {
  comment: string;
  enabled: boolean;
  filters: LookFilter[];
  /** '#rrggbb', or null = keep the item's own colour */
  color: string | null;
  /** 0..1, 1 = no opacity change */
  opacity: number;
  /** only models from this store ('' = all) */
  store: string;
}

/** reset = a clean scene first, append = on top of the rules before,
 *  hide = everything hidden first and the rules show what they match */
export type RulesMode = 'reset' | 'append' | 'hide';

/** A Set Color rule set in force: the whole scene's colours. */
export interface RuleSet {
  mode: RulesMode;
  rules: LookRule[];
}

/** Set Color rules from this time on (instant). */
export interface RulesKey extends RuleSet {
  t: number;
}

/** The labels shown from this time on (instant) — the animation's own copy
 *  of a Label panel set; each label's mute and colours are part of it. */
export interface LabelsKey {
  t: number;
  labels: SceneLabel[];
}

/** The measurements shown from this time on (instant) — the animation's own
 *  copy of a measurement set; each one's visibility is part of it. */
export interface MeasurementsKey {
  t: number;
  measurements: Measurement[];
}

// -----------------------------------------------------------------------------
// steps and callouts
// -----------------------------------------------------------------------------

/** A card a step shows: a design, its values, where and how big. */
export interface StepCard {
  component: string;
  values: Record<string, OverlayValue>;
  /** where on screen (absent = bottom left) */
  place?: Pin;
  /** text size multiplier (absent = 1) */
  textScale?: number;
  /** a library theme for its colours (absent = Auto: the app's light /
   *  dark theme) */
  theme?: string;
}

/** A named span on the Steps row: its card shows while it runs, and
 *  playback can pause at its end. Steps do not overlap. */
export interface Step {
  id: string;
  name: string;
  /** rich text (**bold**, newlines) — {{step.text}} */
  text: string;
  start: number;
  end: number;
  /** its own card; null = no card; absent = the scene's step card */
  card?: StepCard | null;
  pauseAtEnd: boolean;
  /** presenter notes (not in the picture) */
  notes?: string;
}

/** Where a callout sits at a moment: a screen callout's position (0..1 of
 *  the view), an attached one's label offset (px). */
export interface CalloutKey {
  /** seconds after the callout's start — moving the callout moves its keys */
  t: number;
  at: V2;
  interp: Interp;
}

/** An overlay instance shown from `start` to `end`. */
export interface Callout {
  id: string;
  instance: string;
  start: number;
  end: number;
  enter: OverlayFx;
  exit: OverlayFx;
  /** keyed placement (absent = the anchor's own) */
  keys?: CalloutKey[];
}

// -----------------------------------------------------------------------------
// scene
// -----------------------------------------------------------------------------

export interface Scene {
  id: string;
  name: string;
  objects: AnimObject[];
  /** no keys = the view is free; one = fixed there; more = it moves */
  camera: CameraKey[];
  section: SectionKey[];
  colorRules: RulesKey[];
  /** before the first key: no labels; then each key's set */
  labels: LabelsKey[];
  /** before the first key: no measurements; then each key's set */
  measurements: MeasurementsKey[];
  steps: Step[];
  callouts: Callout[];
  loop: boolean;
  /** at the end, play back to the start */
  pingPong: boolean;
  /** pinned end (s); absent = the last key, step or callout end */
  end?: number;
  /** the card every step shows unless it has its own (null = none) */
  stepCard: { component: string; theme: string | null } | null;
  /** attached labels flip / clamp to stay inside the view (absent = on) */
  keepOverlaysOnScreen?: boolean;
}

// -----------------------------------------------------------------------------
// document
// -----------------------------------------------------------------------------

export const ANIMATION_FORMAT = 'tredespace.animation';
export const ANIMATION_VERSION = 2;

export interface AnimationDoc {
  format: typeof ANIMATION_FORMAT;
  version: typeof ANIMATION_VERSION;
  name: string;
  scenes: Scene[];
  overlayInstances: OverlayInstance[];
  /** embedded copies of the designs and themes the doc uses */
  overlayComponents: OverlayComponent[];
  overlayThemes: OverlayTheme[];
}
