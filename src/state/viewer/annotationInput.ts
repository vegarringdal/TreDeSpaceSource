// Untrusted annotation input → well-formed labels and measurements.
//
// Labels and measurements arrive from files the user did not write (a shared
// labels / measurements / viewpoints JSON) and from host payloads that carry a
// whole viewpoint config. Everything here is read field by field: colours are
// canonical hex or the fallback, coordinates are finite numbers, kinds come
// from a fixed list and unknown keys are dropped. The overlays draw these
// values into SVG, so nothing loosely typed may get through.
//
// Pure on purpose (types + pure helpers only) so vitest can import it.
import { colorToHex } from '../../lib/color/hexColor';
import type { V3 } from '../../lib/math/quat';
import { LABEL_FONT_PX, readLabelFontSize } from './labelFont';
import type { LabelsState, SceneLabel } from './labels.state';
import type { Measurement, MeasurePoint, MeasureToolKind } from './measurements.state';
import { readSphereMarker } from './sphereMarker';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** The panel-wide label style a labels file carries next to its items. */
export type LabelStyle = Pick<LabelsState, 'bg' | 'opacity' | 'textColor' | 'fontSize' | 'leaderColor' | 'sphere'>;

/** Per-label fallbacks for fields a file leaves out or gets wrong. */
export type LabelDefaults = Readonly<Pick<LabelsState, 'bg' | 'textColor'>>;

/** A labels file, every part validated. */
export type LabelsFile = Readonly<{ items: SceneLabel[]; muted: boolean; style: LabelStyle }>;

/** A measurements file, every part validated. */
export type MeasurementsFile = Readonly<{
  items: Measurement[];
  muted: boolean;
  precision: number;
  lineColor: string;
}>;

type AxisFlags = [boolean, boolean, boolean];

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const MEASURE_KINDS = [
  'point',
  'line',
  'path',
  'area',
  'diameter',
  'angle',
  'face',
] as const satisfies readonly MeasureToolKind[];

/** The Config panel's precision stepper range (decimals). */
export const MEASURE_PRECISION_MIN = 0;
export const MEASURE_PRECISION_MAX = 6;
const MEASURE_PRECISION_DEFAULT = 3;

const DEFAULT_LINE_COLOR = '#000000';

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A colour as canonical '#rrggbb', or `fallback` when it is not one. */
export function readColor<T extends string | null>(v: unknown, fallback: T): string | T {
  const hex = typeof v === 'string' ? colorToHex(v) : null;
  return hex ?? fallback;
}

function readNumbers(v: unknown, n: number): number[] | null {
  if (!Array.isArray(v) || v.length !== n || !v.every(isFiniteNumber)) {
    return null;
  }

  return v;
}

function readVec2(v: unknown): [number, number] | null {
  const n = readNumbers(v, 2);
  return n ? [n[0], n[1]] : null;
}

function readVec3(v: unknown): V3 | null {
  const n = readNumbers(v, 3);
  return n ? [n[0], n[1], n[2]] : null;
}

function readUnit(v: unknown, fallback: number): number {
  return isFiniteNumber(v) && v >= 0 && v <= 1 ? v : fallback;
}

function readAxisFlags(v: unknown): AxisFlags {
  if (!Array.isArray(v) || v.length !== 3) {
    return [false, false, false];
  }

  return [v[0] === true, v[1] === true, v[2] === true];
}

function readMeasurePoint(v: unknown): MeasurePoint | null {
  if (!isRecord(v)) {
    return null;
  }
  const pos = readVec3(v.pos);
  if (!pos) {
    return null;
  }

  const normal = readVec3(v.normal);
  const clicked = readVec3(v.clicked);
  return { pos, ...(normal ? { normal } : {}), ...(clicked ? { clicked } : {}) };
}

/** The measurement's points, or null when any one is unusable — a measurement
 *  missing a point would measure something else, so it is dropped whole. */
function readMeasurePoints(v: unknown): MeasurePoint[] | null {
  if (!Array.isArray(v)) {
    return null;
  }
  const points: MeasurePoint[] = [];
  for (const raw of v) {
    const point = readMeasurePoint(raw);
    if (!point) {
      return null;
    }
    points.push(point);
  }

  return points;
}

// -----------------------------------------------------------------------------
// Labels
// -----------------------------------------------------------------------------

/** One label from untrusted JSON, or null when it has no text or no finite
 *  [x,y,z] anchor. The id is kept as-is when numeric: every consumer re-bases
 *  ids on the way into the scene (`setAll`). */
export function readLabel(raw: unknown, defaults: LabelDefaults): SceneLabel | null {
  if (!isRecord(raw) || typeof raw.text !== 'string') {
    return null;
  }
  const anchor = readVec3(raw.anchor);
  if (!anchor) {
    return null;
  }

  return {
    id: isFiniteNumber(raw.id) ? raw.id : 0,
    text: raw.text,
    fullname: typeof raw.fullname === 'string' ? raw.fullname : null,
    anchor,
    offset: readVec2(raw.offset) ?? [0, 0],
    selected: false,
    ...(raw.muted === true ? { muted: true } : {}),
    bg: readColor(raw.bg, defaults.bg),
    opacity: readUnit(raw.opacity, 1),
    textColor: readColor(raw.textColor, defaults.textColor),
    // absent = the size every label had before the setting existed
    fontSize: readLabelFontSize(raw.fontSize, LABEL_FONT_PX),
    // null = follow the panel's leader colour
    leaderColor: readColor(raw.leaderColor, null),
    sphere: readSphereMarker(raw.sphere),
  };
}

/** Every usable label in an untrusted JSON array (anything else = none). */
export function readLabels(raw: unknown, defaults: LabelDefaults): SceneLabel[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((l) => readLabel(l, defaults)).filter((l): l is SceneLabel => l !== null);
}

/** A labels file's `style` block: only the six style keys, each validated,
 *  each falling back to `current` when absent or invalid. */
export function readLabelStyle(raw: unknown, current: LabelStyle): LabelStyle {
  const style = isRecord(raw) ? raw : {};
  return {
    bg: readColor(style.bg, current.bg),
    opacity: readUnit(style.opacity, current.opacity),
    textColor: readColor(style.textColor, current.textColor),
    fontSize: readLabelFontSize(style.fontSize, current.fontSize),
    leaderColor: readColor(style.leaderColor, current.leaderColor),
    sphere: style.sphere === undefined ? current.sphere : readSphereMarker(style.sphere),
  };
}

/** A whole labels file (`{ items, muted, style }`, as Save writes it). Style
 *  fields fall back to `current`; per-label colours to the current style. */
export function readLabelsFile(raw: unknown, current: LabelStyle): LabelsFile {
  const file = isRecord(raw) ? raw : {};
  return {
    items: readLabels(file.items, { bg: current.bg, textColor: current.textColor }),
    muted: file.muted === true,
    style: readLabelStyle(file.style, current),
  };
}

// -----------------------------------------------------------------------------
// Measurements
// -----------------------------------------------------------------------------

/** One measurement from untrusted JSON, or null when its kind is unknown or a
 *  point is not a finite [x,y,z]. `id` is the caller's to assign. */
export function readMeasurement(raw: unknown, id: number): Measurement | null {
  if (!isRecord(raw)) {
    return null;
  }
  const kind = MEASURE_KINDS.find((k) => k === raw.kind);
  const points = readMeasurePoints(raw.points);
  if (!kind || !points) {
    return null;
  }

  return {
    id,
    kind,
    points,
    label: typeof raw.label === 'string' ? raw.label : '',
    visible: raw.visible !== false,
    showLabel: raw.showLabel !== false,
    showPerp: raw.showPerp === true,
    axisLegs: readAxisFlags(raw.axisLegs),
    axisLabels: readAxisFlags(raw.axisLabels),
    legsInLabel: raw.legsInLabel === true,
    slopeInLabel: raw.slopeInLabel === true,
    flipAngle: raw.flipAngle === true,
    sphere: readSphereMarker(raw.sphere),
  };
}

/** Every usable measurement in an untrusted JSON array. A file's ids are
 *  kept when they are unique positive integers (viewpoints and the list key
 *  on them); a missing, invalid or repeated id gets the next free one. */
export function readMeasurements(raw: unknown): Measurement[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const taken = new Set<number>();
  let next = 0;
  for (const m of raw) {
    if (isRecord(m) && Number.isSafeInteger(m.id) && isFiniteNumber(m.id) && m.id > 0) {
      taken.add(m.id);
      next = Math.max(next, m.id);
    }
  }
  const used = new Set<number>();
  const out: Measurement[] = [];
  for (const m of raw) {
    const wanted = isRecord(m) && isFiniteNumber(m.id) && taken.has(m.id) && !used.has(m.id) ? m.id : null;
    const id = wanted ?? ++next;
    const read = readMeasurement(m, id);
    if (read) {
      used.add(id);
      out.push(read);
    }
  }

  return out;
}

/** The measurement precision (decimals), clamped to the stepper's range. */
function readMeasurePrecision(v: unknown): number {
  if (!isFiniteNumber(v)) {
    return MEASURE_PRECISION_DEFAULT;
  }

  return Math.max(MEASURE_PRECISION_MIN, Math.min(MEASURE_PRECISION_MAX, Math.round(v)));
}

/** A whole measurements file (`{ items, muted, precision, lineColor }`, as
 *  Save writes it). A missing line colour is black, like an older file. */
export function readMeasurementsFile(raw: unknown): MeasurementsFile {
  const file = isRecord(raw) ? raw : {};
  return {
    items: readMeasurements(file.items),
    muted: file.muted === true,
    precision: readMeasurePrecision(file.precision),
    lineColor: readColor(file.lineColor, DEFAULT_LINE_COLOR),
  };
}
