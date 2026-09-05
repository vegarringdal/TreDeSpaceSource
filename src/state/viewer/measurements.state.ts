// Measurement annotations — Line / Path / Area / Diameter, ported from the
// native renderer (desk3d-state/src/measurements.rs). Pure app-side data: each
// measurement is a list of world-space points captured from a depth probe, plus
// a label. Rendered through the SVG overlay (MeasureOverlay); values are only
// *formatted* (units are metres — model data is treated as m, never converted).
import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { V3 } from '../../lib/math/quat';
import { DEFAULT_SPHERE_MARKER, type SphereMarker } from './sphereMarker';

export type MeasureToolKind = 'point' | 'line' | 'path' | 'area' | 'diameter' | 'angle' | 'face';

/** Placement lock for the NEXT point: relative to the previous segment
 *  (perpendicular / parallel) or along a world axis from the previous point. */
export type MeasureLock = 'none' | 'perp' | 'parallel' | 'x' | 'y' | 'z';

const KIND_LABEL: Record<MeasureToolKind, string> = {
  point: 'Point',
  line: 'Line',
  path: 'Path',
  area: 'Area',
  diameter: 'Diameter',
  angle: 'Angle',
  face: 'Face',
};

/** Point count that auto-finishes the measurement; `null` = open-ended (the
 *  user finishes with double-click / Enter). Point=1, Line/Face=2,
 *  Diameter/Angle=3. */
export function autoFinishAt(kind: MeasureToolKind): number | null {
  if (kind === 'point') {
    return 1;
  }
  if (kind === 'line' || kind === 'face') {
    return 2;
  }
  if (kind === 'diameter' || kind === 'angle') {
    return 3;
  }
  return null; // path / area
}

/** Minimum points for a meaningful result. */
export function minPoints(kind: MeasureToolKind): number {
  if (kind === 'point') {
    return 1;
  }
  return kind === 'area' || kind === 'diameter' || kind === 'angle' ? 3 : 2;
}

/** What the cursor is over, from the hover probe. */
export type MeasureKind = 'face' | 'edge' | 'corner';

/** One hover-probe result: the world point + its classification. */
export interface MeasureHit {
  point: V3;
  /** Surface normal (meaningful for `face`). */
  normal?: V3;
  /** World-space edge direction (meaningful for `edge`). */
  edgeDir?: V3;
  kind: MeasureKind;
}

/** One captured point — the snapped world position, plus the surface normal at
 *  the hit (kept for perpendicular placement) and, for a Shift (perpendicular)
 *  point, the actual clicked point (`pos` is then the perpendicular foot). */
export interface MeasurePoint {
  pos: V3;
  normal?: V3;
  /** The off-axis click for a perpendicular point; `undefined` for a normal one
   *  (then `pos` IS the clicked point). Drives the dashed helper + ΔXYZ end. */
  clicked?: V3;
}

/** The clicked/cursor location — the off-axis click for a perpendicular point,
 *  else `pos`. The ΔXYZ staircase runs to this. */
export function tip(p: MeasurePoint): V3 {
  return p.clicked ?? p.pos;
}

/** Project `point` onto the ray from `p` along its surface normal — the
 *  perpendicular ("measure straight out from a face") constraint. Returns
 *  `point` unchanged when there is no usable normal. */
export function perpProject(p: MeasurePoint, point: V3): V3 {
  const n = p.normal;
  if (!n || n[0] * n[0] + n[1] * n[1] + n[2] * n[2] < 1e-6) {
    return point;
  }
  const nl = Math.hypot(n[0], n[1], n[2]);
  const un: V3 = [n[0] / nl, n[1] / nl, n[2] / nl];
  const d = (point[0] - p.pos[0]) * un[0] + (point[1] - p.pos[1]) * un[1] + (point[2] - p.pos[2]) * un[2];
  return [p.pos[0] + un[0] * d, p.pos[1] + un[1] * d, p.pos[2] + un[2] * d];
}

export interface Measurement {
  id: number;
  kind: MeasureToolKind;
  points: MeasurePoint[];
  label: string;
  /** Angle only: show the reflex angle (360° − θ, arc on the other side). */
  flipAngle?: boolean;
  visible: boolean;
  /** Draw the name as a header on the value in the viewport (per-row toggle). */
  showLabel: boolean;
  /** Show the perpendicular construction helper (dashed off-axis→foot line +
   *  right-angle mark) for points placed with Shift. The per-row "?" toggle. */
  showPerp: boolean;
  /** Per-axis (X/Y/Z) dashed ΔXYZ staircase leg (first→last). */
  axisLegs: [boolean, boolean, boolean];
  /** Per-axis (X/Y/Z) length label on the staircase legs. */
  axisLabels: [boolean, boolean, boolean];
  /** Append the ΔX/ΔY/ΔZ lengths to the main viewport label. */
  legsInLabel: boolean;
  /** Line only: append the slope (∠ from horizontal + % fall) to the label. */
  slopeInLabel: boolean;
  /** 3D wireframe sphere at every point, depth tested — null/absent = none.
   *  The per-row toggle applies the Config default; the API sets it directly. */
  sphere?: SphereMarker | null;
}

// -----------------------------------------------------------------------------
// geometry (mirrors Measurement's methods in measurements.rs)
// -----------------------------------------------------------------------------

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const len2 = (a: V3): number => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];

/** Per-segment lengths (Line/Path), open polyline. */
export function segmentLengths(m: Measurement): number[] {
  const out: number[] = [];
  for (let i = 1; i < m.points.length; i++) {
    out.push(len(sub(m.points[i].pos, m.points[i - 1].pos)));
  }
  return out;
}

export function totalLength(m: Measurement): number {
  return segmentLengths(m).reduce((a, b) => a + b, 0);
}

/** Closed-polygon perimeter (Area). */
export function perimeter(m: Measurement): number {
  const n = m.points.length;
  if (n < 2) {
    return 0;
  }
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += len(sub(m.points[(i + 1) % n].pos, m.points[i].pos));
  }
  return s;
}

/** Polygon area via Newell's method (works for any planar polygon). */
export function area(m: Measurement): number {
  const p = m.points.map((x) => x.pos);
  const n = p.length;
  if (n < 3) {
    return 0;
  }
  let c: V3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = cross(p[i], p[(i + 1) % n]);
    c = [c[0] + x[0], c[1] + x[1], c[2] + x[2]];
  }
  return 0.5 * len(c);
}

/** Fitted circle through the first three points → {center, radius}. `null` if
 *  the points are collinear/degenerate. */
export function circle(m: Measurement): { center: V3; radius: number } | null {
  if (m.points.length < 3) {
    return null;
  }
  const a = m.points[0].pos;
  const u = sub(m.points[1].pos, a);
  const v = sub(m.points[2].pos, a);
  const uxv = cross(u, v);
  const denom = 2 * len2(uxv);
  if (denom < 1e-9) {
    return null;
  }
  const u2 = len2(u);
  const v2 = len2(v);
  // (|u|² v − |v|² u) × (u×v) / (2|u×v|²)
  const t: V3 = [u2 * v[0] - v2 * u[0], u2 * v[1] - v2 * u[1], u2 * v[2] - v2 * u[2]];
  const rel = cross(t, uxv);
  const center: V3 = [a[0] + rel[0] / denom, a[1] + rel[1] / denom, a[2] + rel[2] / denom];
  return { center, radius: len([rel[0] / denom, rel[1] / denom, rel[2] / denom]) };
}

/** Line slope from the horizontal (Z-up): angle in degrees plus the percent
 *  fall (rise over horizontal run; `pct` is null for a vertical line, where
 *  percent slope is undefined). Uses the first→last placed positions. */
export function slope(m: Measurement): { deg: number; pct: number | null } {
  const a = m.points[0];
  const b = m.points[m.points.length - 1];
  if (!a || !b) {
    return { deg: 0, pct: 0 };
  }
  const d = sub(b.pos, a.pos);
  const rise = Math.abs(d[2]);
  const run = Math.hypot(d[0], d[1]);
  const deg = (Math.atan2(rise, run) * 180) / Math.PI;
  return { deg, pct: run > 1e-9 ? (rise / run) * 100 : null };
}

/** Face (2 points): perpendicular gap from the SECOND point to the FIRST
 *  point's face plane, measured along that face's normal — the face-to-face
 *  distance for parallel/near-parallel faces at any orientation. `foot` is the
 *  second point projected onto the first face's plane (null without a usable
 *  normal — the caller falls back to the straight point-to-point distance). */
export function faceGap(m: Measurement): { dist: number; foot: V3 | null } | null {
  const a = m.points[0];
  const b = m.points[1];
  if (!a || !b) {
    return null;
  }
  const n = a.normal;
  const nl = n ? len(n) : 0;
  if (!n || nl < 1e-9) {
    return { dist: len(sub(b.pos, a.pos)), foot: null };
  }
  const u: V3 = [n[0] / nl, n[1] / nl, n[2] / nl];
  const off = sub(b.pos, a.pos);
  const d = off[0] * u[0] + off[1] * u[1] + off[2] * u[2];
  return { dist: Math.abs(d), foot: [b.pos[0] - u[0] * d, b.pos[1] - u[1] * d, b.pos[2] - u[2] * d] };
}

/** Angle at the SECOND point (the vertex) between rays to the first and third,
 *  in degrees; `flipAngle` gives the reflex angle. 0 with <3 points. */
export function angleDeg(m: Measurement): number {
  if (m.points.length < 3) {
    return 0;
  }
  const a = sub(m.points[0].pos, m.points[1].pos);
  const b = sub(m.points[2].pos, m.points[1].pos);
  const la = len(a);
  const lb = len(b);
  if (la < 1e-9 || lb < 1e-9) {
    return 0;
  }
  const cos = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)));
  const deg = (Math.acos(cos) * 180) / Math.PI;
  return m.flipAngle ? 360 - deg : deg;
}

/** Constrain `point` for the active lock. perp and the world-axis locks work
 *  relative to the LAST placed point; parallel projects onto the ONE flat
 *  plane fixed by the FIRST point (its position + surface normal), so the
 *  whole measurement stays planar. Without a usable normal they pass through. */
export function lockProject(lock: MeasureLock, placed: MeasurePoint[], point: V3): V3 {
  const prev = placed[placed.length - 1];
  if (lock === 'none' || !prev) {
    return point;
  }
  const p = prev.pos;
  const d = sub(point, p);
  if (lock === 'x' || lock === 'y' || lock === 'z') {
    // world-axis lock: move only along that axis from the previous point
    const axis = lock === 'x' ? 0 : lock === 'y' ? 1 : 2;
    const out: V3 = [p[0], p[1], p[2]];
    out[axis] += d[axis];
    return out;
  }
  if (lock === 'parallel') {
    // every point lands in the plane through the FIRST point, perpendicular
    // to ITS normal — the measurement is flat regardless of what got clicked
    const first = placed[0];
    const n = first.normal;
    if (!n) {
      return point;
    }
    const l = len(n);
    if (l < 1e-9) {
      return point;
    }
    const u: V3 = [n[0] / l, n[1] / l, n[2] / l];
    const off = sub(point, first.pos);
    const along = off[0] * u[0] + off[1] * u[1] + off[2] * u[2];
    return [point[0] - u[0] * along, point[1] - u[1] * along, point[2] - u[2] * along];
  }
  // perpendicular (to the surface): move only along the previous point's normal ray
  const n = prev.normal;
  if (!n) {
    return point;
  }
  const l = len(n);
  if (l < 1e-9) {
    return point;
  }
  const u: V3 = [n[0] / l, n[1] / l, n[2] / l];
  const along = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  return [p[0] + u[0] * along, p[1] + u[1] * along, p[2] + u[2] * along];
}

/** The headline numeric value (length / total / area / diameter / angle). */
export function primaryValue(m: Measurement): number {
  switch (m.kind) {
    case 'point':
      return 0; // a coordinate annotation has no headline value
    case 'angle':
      return angleDeg(m);
    case 'line':
    case 'path':
      return totalLength(m);
    case 'area':
      return area(m);
    case 'diameter':
      return (circle(m)?.radius ?? 0) * 2;
    case 'face':
      return faceGap(m)?.dist ?? 0;
  }
}

/** Headline value formatted with units (m, m², Ø m) at `precision` decimals. */
export function valueLabel(m: Measurement, precision: number): string {
  switch (m.kind) {
    case 'point': {
      const p = m.points[0]?.pos ?? [0, 0, 0];
      return `X ${formatM(p[0], precision)}\nY ${formatM(p[1], precision)}\nZ ${formatM(p[2], precision)}`;
    }
    case 'line':
      return formatM(totalLength(m), precision);
    case 'path':
      return `Σ ${formatM(totalLength(m), precision)}`;
    case 'area':
      return `${formatM(area(m), precision)}²`;
    case 'diameter':
      return `Ø ${formatM(primaryValue(m), precision)}`;
    case 'angle':
      return `∠ ${angleDeg(m).toFixed(Math.min(precision, 2))}°`;
    case 'face': {
      const g = faceGap(m);
      return g ? `⊥ ${formatM(g.dist, precision)}` : '—';
    }
  }
}

/** First→last delta to the *clicked* points (the ΔX/ΔY/ΔZ legs for Line/Path) —
 *  runs to the actual click, not the perpendicular foot. Zero with <2 points. */
export function span(m: Measurement): V3 {
  const a = m.points[0];
  const b = m.points[m.points.length - 1];
  if (!a || !b) {
    return [0, 0, 0];
  }
  const ta = tip(a);
  const tb = tip(b);
  return [tb[0] - ta[0], tb[1] - ta[1], tb[2] - ta[2]];
}

/** The name shown in the list and (optionally) as a viewport header. */
export function displayName(m: Measurement): string {
  return m.label || KIND_LABEL[m.kind];
}

/** Format metres with space-grouped thousands + trailing " m". */
export function formatM(v: number, precision: number): string {
  const neg = v < 0;
  const s = Math.abs(v).toFixed(precision);
  const [intPart, frac] = s.split('.');
  // group the integer part in threes with a thin space
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const body = frac ? `${grouped}.${frac}` : grouped;
  return `${neg ? '-' : ''}${body} m`;
}

// -----------------------------------------------------------------------------
// store
// -----------------------------------------------------------------------------

export interface MeasurementsState {
  items: Measurement[];
  /** Global mute — hides every measurement (per-item `visible` preserved). */
  muted: boolean;
  /** The active tool (mirrors the ribbon; null = Off / picking). */
  activeKind: MeasureToolKind | null;
  /** In-progress points for the active tool (not yet committed). */
  inProgress: MeasurePoint[];
  /** Live hover-probe result (rubber-band + snap glyph); null when off-surface. */
  hover: MeasureHit | null;
  /** Whether Shift is held (perpendicular placement mode). */
  perp: boolean;
  /** Placement lock for the next point (ribbon Lock section). */
  lock: MeasureLock;
  /** Snap tuning for the hover probe. */
  snap: SnapConfig;
  precision: number;
  /** Line/marker/fill colour for every measurement in the viewport. */
  lineColor: string;
  /** Point sphere the per-row toggle applies (and every current sphere follows). */
  sphere: SphereMarker;
  nextId: number;
}

/** Snap tuning for the measure probe — screen-space pixel radii so sensitivity
 *  is triangle-size- and zoom-independent. Master off = raw surface point. */
export interface SnapConfig {
  enabled: boolean;
  corner: boolean;
  edge: boolean;
  /** snap onto the line where two different items intersect (a box through a floor) */
  seam: boolean;
  cornerPx: number;
  edgePx: number;
}

const INITIAL: MeasurementsState = {
  items: [],
  muted: false,
  activeKind: null,
  inProgress: [],
  hover: null,
  perp: false,
  lock: 'none',
  snap: { enabled: true, corner: true, edge: true, seam: true, cornerPx: 12, edgePx: 8 },
  precision: 3,
  lineColor: '#000000',
  sphere: { ...DEFAULT_SPHERE_MARKER },
  nextId: 0,
};

export const measurementsState = createStore<MeasurementsState>(INITIAL);
