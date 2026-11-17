// -----------------------------------------------------------------------------
// labels and measurements over time (DESIGN.md › Animation › Data model)
// -----------------------------------------------------------------------------
// The Labels and Measurements rows: each key holds the animation's own copy
// of a set — fixed points in the model, shown from the key's time on (before
// the first key: none). Strict parsers for the file (no CSS: colours are
// #rrggbb), the key in force at a time, and a comparable form of a set (ids
// and selection left out). Pure.

import type { SceneLabel } from '../../state/viewer/labels.state';
import type { Measurement, MeasurePoint, MeasureToolKind } from '../../state/viewer/measurements.state';
import { readSphereMarker } from '../../state/viewer/sphereMarker';
import { arr, bool, FieldError, num, obj, oneOf, str, v2, v3 } from '../jsonFields';
import { keyIndexAt } from './interp';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const MEASURE_KINDS = [
  'point',
  'line',
  'path',
  'area',
  'diameter',
  'angle',
  'face',
] as const satisfies readonly MeasureToolKind[];
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function hex(v: unknown, path: string, fallback: string): string {
  if (v === undefined) {
    return fallback;
  }
  if (typeof v !== 'string' || !HEX6_RE.test(v)) {
    throw new FieldError(`${path}: expected a colour "#rrggbb"`);
  }
  return v;
}

function bools3(v: unknown, path: string): [boolean, boolean, boolean] {
  if (v === undefined) {
    return [false, false, false];
  }
  const a = arr(v, path);
  if (a.length !== 3) {
    throw new FieldError(`${path}: expected [x, y, z] of true / false`);
  }
  return [bool(a[0], `${path}[0]`), bool(a[1], `${path}[1]`), bool(a[2], `${path}[2]`)];
}

function point(v: unknown, path: string): MeasurePoint {
  const o = obj(v, path);
  return {
    pos: v3(o.pos, `${path}.pos`),
    ...(o.normal !== undefined ? { normal: v3(o.normal, `${path}.normal`) } : {}),
    ...(o.clicked !== undefined ? { clicked: v3(o.clicked, `${path}.clicked`) } : {}),
  };
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** A label of a Labels key (as the Label panel saves one). */
export function parseLabel(v: unknown, path: string, i: number): SceneLabel {
  const o = obj(v, path);
  const fullname = o.fullname === undefined || o.fullname === null ? null : str(o.fullname, `${path}.fullname`);
  const sphere = readSphereMarker(o.sphere);
  return {
    id: o.id === undefined ? i + 1 : num(o.id, `${path}.id`),
    text: str(o.text, `${path}.text`, ''),
    fullname,
    anchor: v3(o.anchor, `${path}.anchor`),
    offset: o.offset === undefined ? [0, 0] : v2(o.offset, `${path}.offset`),
    selected: false,
    ...(o.muted === true ? { muted: true } : {}),
    bg: hex(o.bg, `${path}.bg`, '#ffffff'),
    opacity: Math.min(1, Math.max(0, num(o.opacity, `${path}.opacity`, 1))),
    textColor: hex(o.textColor, `${path}.textColor`, '#14161a'),
    ...(o.leaderColor !== undefined && o.leaderColor !== null
      ? { leaderColor: hex(o.leaderColor, `${path}.leaderColor`, '#000000') }
      : {}),
    ...(sphere ? { sphere } : {}),
  };
}

/** A measurement of a Measurements key (as the measuring tools save one). */
export function parseMeasurement(v: unknown, path: string, i: number): Measurement {
  const o = obj(v, path);
  const points = arr(o.points, `${path}.points`).map((p, k) => point(p, `${path}.points[${k}]`));
  const sphere = readSphereMarker(o.sphere);
  return {
    id: o.id === undefined ? i + 1 : num(o.id, `${path}.id`),
    kind: oneOf(o.kind, MEASURE_KINDS, `${path}.kind`),
    points,
    label: str(o.label, `${path}.label`, ''),
    ...(o.flipAngle === true ? { flipAngle: true } : {}),
    visible: bool(o.visible, `${path}.visible`, true),
    showLabel: bool(o.showLabel, `${path}.showLabel`, true),
    showPerp: bool(o.showPerp, `${path}.showPerp`, false),
    axisLegs: bools3(o.axisLegs, `${path}.axisLegs`),
    axisLabels: bools3(o.axisLabels, `${path}.axisLabels`),
    legsInLabel: bool(o.legsInLabel, `${path}.legsInLabel`, false),
    slopeInLabel: bool(o.slopeInLabel, `${path}.slopeInLabel`, false),
    ...(sphere ? { sphere } : {}),
  };
}

/** The key in force at T (null before the first). */
export function keyAt<K extends { t: number }>(keys: readonly K[], T: number): K | null {
  const i = keyIndexAt(keys, T);
  return i < 0 ? null : (keys[i] ?? null);
}

/** A label set as it compares: what is shown, not ids or selection. */
export function labelsText(items: readonly SceneLabel[]): string {
  return JSON.stringify(items.map(({ id: _id, selected: _sel, ...rest }) => rest));
}

/** A measurement set as it compares: what is shown, not ids. */
export function measurementsText(items: readonly Measurement[]): string {
  return JSON.stringify(items.map(({ id: _id, ...rest }) => rest));
}

/** A label set as a key stores it (nothing selected). */
export function labelsForKey(items: readonly SceneLabel[]): SceneLabel[] {
  return items.map((l) => ({ ...structuredClone(l), selected: false }));
}
