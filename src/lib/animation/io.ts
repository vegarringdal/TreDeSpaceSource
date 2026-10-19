// -----------------------------------------------------------------------------
// animation file I/O, version 2 (DESIGN.md › Animation › Files and host API)
// -----------------------------------------------------------------------------
// Parse + validate `*.tdanim.json`. Files arrive from users, Claude and host
// pages, so validation is strict: wrong types are errors naming their path,
// unknown keys are dropped, overlay content obeys the overlay safety rules.
// Version 1 files (the parts / clips tool) are refused with a clear message.
// Missing ids of scenes, objects, steps and callouts are made up; an object
// key's rotation may be written as an axis and degrees. Pure: returns { doc }
// or { error }, never throws.

import { arr, bool, FieldError, id, isObj, num, obj, oneOf, quat, readField, str, v2, v3 } from '../jsonFields';
import { component, fx, instance, textScale, theme, value } from '../overlay/overlayParse';
import { PRESET_STEP_CARD } from '../overlay/overlayPresets';
import type { OverlayValue, Pin } from '../overlay/overlayTypes';
import { parseLabel, parseMeasurement } from './annotations';
import { qAxisAngle } from './interp';
import { isPivotAnchor, PIVOT_ANCHORS } from './pivots';
import {
  ANIMATION_FORMAT,
  ANIMATION_VERSION,
  type AnimationDoc,
  type AnimCamera,
  type AnimObject,
  type Callout,
  type CalloutKey,
  type CameraKey,
  type ClipBoxState,
  type ClipPlaneState,
  type ClipShapeState,
  type ClipStateValue,
  type Interp,
  type KeyPivot,
  type LabelsKey,
  type LookFilter,
  type LookRule,
  type MeasurementsKey,
  type ObjectKey,
  type ObjectPivot,
  type Quat,
  type RulesKey,
  type Scene,
  type SectionKey,
  type Step,
  type StepCard,
} from './types';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export type ParseResult = Readonly<{ doc?: AnimationDoc; error?: string }>;

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const INTERP_VALUES: readonly Interp[] = ['smooth', 'linear', 'hold'];
const PINS: readonly Pin[] = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];
/** Rule and key colours: the Set Color engine takes '#rrggbb' only. */
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const RULES_MODES = ['reset', 'append', 'hide'] as const;
const FILTER_OPS = ['append', 'remove', 'keep'] as const;
const FILTER_MODES = ['contains', 'single', 'multi', 'starts', 'ends', 'wildcard'] as const;
/** Clip shapes a section key may hold (the renderer's user-shape slots). */
const MAX_CLIP_SHAPES = 7;
/** Hard ceiling on a doc's size (characters) — a guard, not a design limit. */
const MAX_DOC_CHARS = 64 << 20;
/** Two times closer than this are the same moment (s). */
const SAME_T_S = 1e-6;
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

// -----------------------------------------------------------------------------
// readers
// -----------------------------------------------------------------------------

function time(v: unknown, path: string): number {
  const t = num(v, path);
  if (t < 0) {
    throw new FieldError(`${path}: a time cannot be negative`);
  }
  return t;
}

function interp(v: unknown, path: string): Interp {
  return oneOf(v, INTERP_VALUES, path, 'smooth');
}

/** An id, or a made-up one when the file leaves it out. */
function idOrNew(v: unknown, path: string, prefix: string): string {
  return v === undefined ? newId(prefix) : id(v, path);
}

function hexOrNull(v: unknown, path: string): string | null {
  if (v === null) {
    return null;
  }
  const c = str(v, path);
  if (!HEX6_RE.test(c)) {
    throw new FieldError(`${path}: expected a #rrggbb colour (or null for the item's own)`);
  }
  return c.toLowerCase();
}

/** A rotation: a quaternion [x, y, z, w], or { axis: [x, y, z], degrees }. */
function rotation(v: unknown, path: string): Quat {
  if (v === undefined) {
    return [0, 0, 0, 1];
  }
  if (isObj(v)) {
    return qAxisAngle(v3(v.axis, `${path}.axis`), num(v.degrees, `${path}.degrees`));
  }
  return quat(v, path);
}

/** Keys in time order; a later key at the same time replaces the earlier. */
function byTime<K extends { t: number }>(keys: K[]): K[] {
  const sorted = keys.map((k, i) => ({ k, i })).sort((a, b) => a.k.t - b.k.t || a.i - b.i);
  const out: K[] = [];
  for (const { k } of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - k.t) < SAME_T_S) {
      out[out.length - 1] = k;
    } else {
      out.push(k);
    }
  }
  return out;
}

function camera(v: unknown, path: string): AnimCamera {
  const o = obj(v, path);
  return {
    target: v3(o.target, `${path}.target`),
    azimuth: num(o.azimuth, `${path}.azimuth`),
    elevation: num(o.elevation, `${path}.elevation`),
    orbitDistance: num(o.orbitDistance, `${path}.orbitDistance`),
    orthographic: bool(o.orthographic, `${path}.orthographic`, false),
    ...(o.sketch !== undefined ? { sketch: bool(o.sketch, `${path}.sketch`) } : {}),
  };
}

// -----------------------------------------------------------------------------
// objects
// -----------------------------------------------------------------------------

function objectKey(v: unknown, path: string): ObjectKey {
  const o = obj(v, path);
  const key: ObjectKey = {
    t: time(o.t, `${path}.t`),
    move: o.move === undefined ? [0, 0, 0] : v3(o.move, `${path}.move`),
    rotate: rotation(o.rotate, `${path}.rotate`),
    interp: interp(o.interp, `${path}.interp`),
  };
  if (o.spin !== undefined) {
    const s = obj(o.spin, `${path}.spin`);
    key.spin = { axis: v3(s.axis, `${path}.spin.axis`), degrees: num(s.degrees, `${path}.spin.degrees`) };
  }
  if (o.pivot !== undefined) {
    key.pivot = keyPivot(o.pivot, `${path}.pivot`);
  }
  if (o.visible !== undefined) {
    key.visible = bool(o.visible, `${path}.visible`);
  }
  if (o.opacity !== undefined) {
    key.opacity = Math.min(1, Math.max(0, num(o.opacity, `${path}.opacity`)));
  }
  if (o.color !== undefined) {
    key.color = hexOrNull(o.color, `${path}.color`);
  }
  return key;
}

const ANCHORS_TEXT = PIVOT_ANCHORS.map((a) => `"${a}"`).join(', ');

function pivot(v: unknown, path: string): ObjectPivot {
  if (v === undefined) {
    return 'center';
  }
  if (isPivotAnchor(v)) {
    return v;
  }
  if (typeof v === 'string') {
    throw new FieldError(`${path}: expected ${ANCHORS_TEXT} or [x, y, z]`);
  }
  return v3(v, path);
}

/** A key's pivot: `{ at, offset? }` — `at` a side of the object's box or a
 *  point [x, y, z]; a bare side or point is read as `{ at }`. */
function keyPivot(v: unknown, path: string): KeyPivot {
  if (isPivotAnchor(v) || Array.isArray(v)) {
    return { at: pivot(v, path) };
  }
  const o = obj(v, path);
  const at = pivot(o.at, `${path}.at`);
  return o.offset === undefined ? { at } : { at, offset: v3(o.offset, `${path}.offset`) };
}

function animObject(v: unknown, path: string): AnimObject {
  const o = obj(v, path);
  const items = arr(o.items, `${path}.items`).map((f, i) => str(f, `${path}.items[${i}]`).toLowerCase());
  if (items.length === 0) {
    throw new FieldError(`${path}.items: an object needs at least one item`);
  }
  const exclude = arr(o.exclude, `${path}.exclude`, true).map((f, i) => str(f, `${path}.exclude[${i}]`).toLowerCase());
  return {
    id: idOrNew(o.id, `${path}.id`, 'o'),
    name: str(o.name, `${path}.name`, ''),
    items,
    ...(exclude.length > 0 ? { exclude } : {}),
    pivot: pivot(o.pivot, `${path}.pivot`),
    path: oneOf(o.path, ['straight', 'smooth'] as const, `${path}.path`, 'straight'),
    keys: byTime(arr(o.keys, `${path}.keys`, true).map((k, i) => objectKey(k, `${path}.keys[${i}]`))),
    ...(o.muted === true ? { muted: true } : {}),
  };
}

// -----------------------------------------------------------------------------
// scene rows
// -----------------------------------------------------------------------------

function cameraKey(v: unknown, path: string): CameraKey {
  const o = obj(v, path);
  return {
    t: time(o.t, `${path}.t`),
    view: camera(o.view, `${path}.view`),
    interp: interp(o.interp, `${path}.interp`),
  };
}

function clipBox(v: unknown, path: string): ClipBoxState {
  const o = obj(v, path);
  return {
    enabled: bool(o.enabled, `${path}.enabled`),
    boxOn: bool(o.boxOn, `${path}.boxOn`, true),
    center: v3(o.center, `${path}.center`),
    size: v3(o.size, `${path}.size`),
    rotation: o.rotation === undefined ? [0, 0, 0, 1] : quat(o.rotation, `${path}.rotation`),
    inverted: bool(o.inverted, `${path}.inverted`, false),
  };
}

function clipPlane(v: unknown, path: string): ClipPlaneState {
  const o = obj(v, path);
  return {
    enabled: bool(o.enabled, `${path}.enabled`),
    position: num(o.position, `${path}.position`),
    el: num(o.el, `${path}.el`, 0),
    az: num(o.az, `${path}.az`, 0),
    flipped: bool(o.flipped, `${path}.flipped`, false),
    anchor: o.anchor === null || o.anchor === undefined ? null : v3(o.anchor, `${path}.anchor`),
  };
}

function clipShape(v: unknown, path: string): ClipShapeState {
  const o = obj(v, path);
  return {
    kind: oneOf(o.kind, ['sphere', 'cylinder', 'box'] as const, `${path}.kind`),
    label: str(o.label, `${path}.label`, ''),
    center: v3(o.center, `${path}.center`),
    axis: o.axis === undefined ? [0, 0, 1] : v3(o.axis, `${path}.axis`),
    radius: Math.max(0, num(o.radius, `${path}.radius`, 1)),
    height: Math.max(0, num(o.height, `${path}.height`, 1)),
    halfExtents: o.halfExtents === undefined ? [1, 1, 1] : v3(o.halfExtents, `${path}.halfExtents`),
    rotation: o.rotation === undefined ? [0, 0, 0, 1] : quat(o.rotation, `${path}.rotation`),
    enabled: bool(o.enabled, `${path}.enabled`, true),
    inverted: bool(o.inverted, `${path}.inverted`, false),
  };
}

const OFF_PLANE: ClipPlaneState = { enabled: false, position: 0, el: 0, az: 0, flipped: false, anchor: null };

function clipState(v: unknown, path: string): ClipStateValue {
  const o = obj(v, path);
  const planes = o.planes === undefined ? {} : obj(o.planes, `${path}.planes`);
  const plane = (axis: 'x' | 'y' | 'z') =>
    planes[axis] === undefined ? { ...OFF_PLANE } : clipPlane(planes[axis], `${path}.planes.${axis}`);
  const shapes = arr(o.shapes, `${path}.shapes`, true);
  if (shapes.length > MAX_CLIP_SHAPES) {
    throw new FieldError(`${path}.shapes: at most ${MAX_CLIP_SHAPES} clip shapes`);
  }
  return {
    box:
      o.box === undefined
        ? { enabled: false, boxOn: true, center: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 0, 1], inverted: false }
        : clipBox(o.box, `${path}.box`),
    planes: { x: plane('x'), y: plane('y'), z: plane('z') },
    shapes: shapes.map((x, i) => clipShape(x, `${path}.shapes[${i}]`)),
  };
}

function sectionKey(v: unknown, path: string): SectionKey {
  const o = obj(v, path);
  return {
    t: time(o.t, `${path}.t`),
    value: clipState(o.value, `${path}.value`),
    interp: interp(o.interp, `${path}.interp`),
  };
}

function lookFilter(v: unknown, path: string): LookFilter {
  const o = obj(v, path);
  return {
    op: oneOf(o.op, FILTER_OPS, `${path}.op`, 'append'),
    mode: oneOf(o.mode, FILTER_MODES, `${path}.mode`),
    value: str(o.value, `${path}.value`),
    comment: str(o.comment, `${path}.comment`, ''),
    level: Math.max(0, Math.round(num(o.level, `${path}.level`, 0))),
  };
}

function lookRule(v: unknown, path: string): LookRule {
  const o = obj(v, path);
  return {
    comment: str(o.comment, `${path}.comment`, ''),
    enabled: bool(o.enabled, `${path}.enabled`, true),
    filters: arr(o.filters, `${path}.filters`).map((f, i) => lookFilter(f, `${path}.filters[${i}]`)),
    color: o.color === undefined ? null : hexOrNull(o.color, `${path}.color`),
    opacity: Math.min(1, Math.max(0, num(o.opacity, `${path}.opacity`, 1))),
    store: str(o.store, `${path}.store`, ''),
  };
}

function rulesKey(v: unknown, path: string): RulesKey {
  const o = obj(v, path);
  return {
    t: time(o.t, `${path}.t`),
    mode: oneOf(o.mode, RULES_MODES, `${path}.mode`, 'reset'),
    rules: arr(o.rules, `${path}.rules`, true).map((r, i) => lookRule(r, `${path}.rules[${i}]`)),
  };
}

function labelsKey(v: unknown, path: string): LabelsKey {
  const o = obj(v, path);
  return {
    t: time(o.t, `${path}.t`),
    labels: arr(o.labels, `${path}.labels`, true).map((l, i) => parseLabel(l, `${path}.labels[${i}]`, i)),
  };
}

function measurementsKey(v: unknown, path: string): MeasurementsKey {
  const o = obj(v, path);
  return {
    t: time(o.t, `${path}.t`),
    measurements: arr(o.measurements, `${path}.measurements`, true).map((m, i) =>
      parseMeasurement(m, `${path}.measurements[${i}]`, i),
    ),
  };
}

// -----------------------------------------------------------------------------
// steps and callouts
// -----------------------------------------------------------------------------

function values(v: unknown, path: string): Record<string, OverlayValue> {
  const o = v === undefined ? {} : obj(v, path);
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, value(x, `${path}.${k}`)]));
}

function stepCard(v: unknown, path: string): StepCard | null {
  if (v === null) {
    return null;
  }
  const o = obj(v, path);
  const card: StepCard = {
    component: id(o.component, `${path}.component`),
    values: values(o.values, `${path}.values`),
  };
  if (o.place !== undefined) {
    card.place = oneOf(o.place, PINS, `${path}.place`);
  }
  if (o.textScale !== undefined) {
    card.textScale = textScale(o.textScale, `${path}.textScale`);
  }
  // null (or absent) = Auto, the app's light / dark theme
  if (o.theme !== undefined && o.theme !== null) {
    card.theme = id(o.theme, `${path}.theme`);
  }
  return card;
}

function step(v: unknown, path: string): Step {
  const o = obj(v, path);
  const start = time(o.start, `${path}.start`);
  const end = time(o.end, `${path}.end`);
  if (end < start) {
    throw new FieldError(`${path}: ends (${end} s) before it starts (${start} s)`);
  }
  const s: Step = {
    id: idOrNew(o.id, `${path}.id`, 'st'),
    name: str(o.name, `${path}.name`, ''),
    text: str(o.text, `${path}.text`, ''),
    start,
    end,
    pauseAtEnd: bool(o.pauseAtEnd, `${path}.pauseAtEnd`, false),
  };
  if (o.card !== undefined) {
    s.card = stepCard(o.card, `${path}.card`);
  }
  if (o.notes !== undefined) {
    s.notes = str(o.notes, `${path}.notes`);
  }
  return s;
}

function calloutKey(v: unknown, path: string): CalloutKey {
  const o = obj(v, path);
  return { t: time(o.t, `${path}.t`), at: v2(o.at, `${path}.at`), interp: interp(o.interp, `${path}.interp`) };
}

function callout(v: unknown, path: string): Callout {
  const o = obj(v, path);
  const start = time(o.start, `${path}.start`);
  const end = time(o.end, `${path}.end`);
  if (end < start) {
    throw new FieldError(`${path}: ends (${end} s) before it starts (${start} s)`);
  }
  return {
    id: idOrNew(o.id, `${path}.id`, 'c'),
    instance: id(o.instance, `${path}.instance`),
    start,
    end,
    enter: fx(o.enter, `${path}.enter`),
    exit: fx(o.exit, `${path}.exit`),
    ...(o.keys === undefined
      ? {}
      : { keys: byTime(arr(o.keys, `${path}.keys`).map((k, i) => calloutKey(k, `${path}.keys[${i}]`))) }),
  };
}

/** Steps may not overlap (the step under the playhead must be one). */
function noOverlap(steps: readonly Step[], path: string): void {
  const sorted = [...steps].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (sorted[i].start < prev.end - SAME_T_S) {
      throw new FieldError(
        `${path}: step "${sorted[i].name || sorted[i].id}" starts before "${prev.name || prev.id}" ends`,
      );
    }
  }
}

function scene(v: unknown, path: string): Scene {
  const o = obj(v, path);
  const steps = arr(o.steps, `${path}.steps`, true).map((s, i) => step(s, `${path}.steps[${i}]`));
  noOverlap(steps, `${path}.steps`);
  const card = o.stepCard;
  // absent = the built-in step card; null = steps show no card
  let stepCardDefault: Scene['stepCard'] = card === undefined ? defaultStepCard() : null;
  if (card !== null && card !== undefined) {
    const c = obj(card, `${path}.stepCard`);
    stepCardDefault = {
      component: id(c.component, `${path}.stepCard.component`),
      theme: c.theme === null || c.theme === undefined ? null : id(c.theme, `${path}.stepCard.theme`),
    };
  }
  const s: Scene = {
    id: idOrNew(o.id, `${path}.id`, 's'),
    name: str(o.name, `${path}.name`, 'Scene'),
    objects: arr(o.objects, `${path}.objects`, true).map((x, i) => animObject(x, `${path}.objects[${i}]`)),
    camera: byTime(arr(o.camera, `${path}.camera`, true).map((k, i) => cameraKey(k, `${path}.camera[${i}]`))),
    section: byTime(arr(o.section, `${path}.section`, true).map((k, i) => sectionKey(k, `${path}.section[${i}]`))),
    colorRules: byTime(
      arr(o.colorRules, `${path}.colorRules`, true).map((k, i) => rulesKey(k, `${path}.colorRules[${i}]`)),
    ),
    labels: byTime(arr(o.labels, `${path}.labels`, true).map((k, i) => labelsKey(k, `${path}.labels[${i}]`))),
    measurements: byTime(
      arr(o.measurements, `${path}.measurements`, true).map((k, i) => measurementsKey(k, `${path}.measurements[${i}]`)),
    ),
    steps: steps.sort((a, b) => a.start - b.start),
    callouts: arr(o.callouts, `${path}.callouts`, true).map((c, i) => callout(c, `${path}.callouts[${i}]`)),
    loop: bool(o.loop, `${path}.loop`, false),
    pingPong: bool(o.pingPong, `${path}.pingPong`, false),
    stepCard: stepCardDefault,
  };
  if (o.end !== undefined) {
    s.end = time(o.end, `${path}.end`);
  }
  if (o.keepOverlaysOnScreen === false) {
    s.keepOverlaysOnScreen = false;
  }
  return s;
}

/** First id used twice inside one id space, or null. */
function duplicateId(doc: AnimationDoc): string | null {
  const spaces: string[][] = [
    doc.scenes.map((s) => s.id),
    // objects are looked up doc-wide (overlay anchors, the worker capture)
    doc.scenes.flatMap((s) => s.objects.map((o) => o.id)),
    ...doc.scenes.map((s) => [...s.steps.map((x) => x.id), ...s.callouts.map((c) => c.id)]),
    doc.overlayInstances.map((i) => i.id),
    doc.overlayComponents.map((c) => c.id),
    doc.overlayThemes.map((t) => t.id),
  ];
  for (const ids of spaces) {
    const seen = new Set<string>();
    for (const x of ids) {
      if (seen.has(x)) {
        return x;
      }
      seen.add(x);
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Validate an already-parsed value as an animation doc (Open, the SDK's
 *  `animation.load`, the draft). */
export function validateAnimationDoc(input: unknown): ParseResult {
  const r = readField((): AnimationDoc | string => {
    const o = obj(input, 'doc');
    if (o.format !== ANIMATION_FORMAT) {
      return `Not an animation file (format "${String(o.format).slice(0, 40)}")`;
    }
    const version = num(o.version, 'version');
    if (version < ANIMATION_VERSION) {
      return (
        `This animation file is version ${version} — from the earlier parts-and-clips animation tool, ` +
        `which this version cannot open. Make it again in the Timeline (objects and keys).`
      );
    }
    if (version > ANIMATION_VERSION) {
      return `This animation was saved by a newer version (file v${version}, app reads v${ANIMATION_VERSION})`;
    }
    const scenes = arr(o.scenes, 'scenes', true).map((s, i) => scene(s, `scenes[${i}]`));
    return {
      format: ANIMATION_FORMAT,
      version: ANIMATION_VERSION,
      name: str(o.name, 'name', 'Animation'),
      scenes: scenes.length > 0 ? scenes : [emptyScene()],
      overlayInstances: arr(o.overlayInstances, 'overlayInstances', true).map((x, i) =>
        instance(x, `overlayInstances[${i}]`),
      ),
      overlayComponents: arr(o.overlayComponents, 'overlayComponents', true).map((x, i) =>
        component(x, `overlayComponents[${i}]`),
      ),
      overlayThemes: arr(o.overlayThemes, 'overlayThemes', true).map((x, i) => theme(x, `overlayThemes[${i}]`)),
    };
  });
  if (r.error !== undefined) {
    return { error: r.error };
  }
  if (typeof r.value === 'string' || r.value === undefined) {
    return { error: r.value ?? 'Unreadable animation file' };
  }
  const dupe = duplicateId(r.value);
  return dupe ? { error: `Duplicate id "${dupe}"` } : { doc: r.value };
}

/** Parse + validate a `*.tdanim.json` text. */
export function parseAnimationDoc(text: string): ParseResult {
  if (text.length > MAX_DOC_CHARS) {
    return { error: 'The animation file is too large' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  return validateAnimationDoc(raw);
}

/** Pretty JSON for Save (key order = the types' declaration order). */
export function serializeAnimationDoc(doc: AnimationDoc): string {
  return JSON.stringify(doc, null, 1);
}

// -----------------------------------------------------------------------------
// factories
// -----------------------------------------------------------------------------

/** Short random id (8 chars, ~40 bits). */
export function newId(prefix = ''): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = prefix;
  for (const b of bytes) {
    out += ID_ALPHABET[b % ID_ALPHABET.length];
  }
  return out;
}

/** The card steps show unless they or the scene say otherwise. */
export function defaultStepCard(): NonNullable<Scene['stepCard']> {
  return { component: PRESET_STEP_CARD.id, theme: null };
}

/** An empty scene. */
export function emptyScene(name = 'Scene 1'): Scene {
  return {
    id: newId('s'),
    name,
    objects: [],
    camera: [],
    section: [],
    colorRules: [],
    labels: [],
    measurements: [],
    steps: [],
    callouts: [],
    loop: false,
    pingPong: false,
    stepCard: defaultStepCard(),
  };
}

/** A fresh doc with one empty scene. */
export function emptyDoc(name = 'Animation'): AnimationDoc {
  return {
    format: ANIMATION_FORMAT,
    version: ANIMATION_VERSION,
    name,
    scenes: [emptyScene()],
    overlayInstances: [],
    overlayComponents: [],
    overlayThemes: [],
  };
}
