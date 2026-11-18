// The axis-ball navigation gizmo's geometry, shared by the GPU paint
// (axisGizmoPaint.ts, drawn by ViewCubePass) and the DOM hit layer
// (overlay/AxisBallLayer.ts), so what is drawn and what is clicked are the
// same. Also the cube's true-north marker. Units: one cube edge (the DOM
// gizmo's stage size); screen offsets are from the gizmo centre, y down.
// Pure: no DOM, no GPU, so unit tests load it directly.
import type { GizmoFace } from '../overlay/ViewGizmo';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];
export type Quat = Readonly<{ x: number; y: number; z: number; w: number }>;

/** Which navigation gizmo the viewport shows. */
export type NavGizmoStyle = 'cube' | 'balls';

/** The axis balls' in-between snap dots: 45° sides + iso corners, or all 20. */
export type SnapDotSet = 'iso' | 'all';

/** The gizmo view's screen axes in world space: right, up and toward the viewer. */
export type GizmoBasis = Readonly<{ right: Vec3; up: Vec3; back: Vec3 }>;

export type AxisBall = Readonly<{ face: GizmoFace; axis: 'X' | 'Y' | 'Z'; sign: 1 | -1 }>;

export type AxisItem = Readonly<{
  kind: 'ball' | 'dot';
  /** `ball:<face>` or `dot:<sx>,<sy>,<sz>` — also the hover key. */
  id: string;
  /** Unit world direction from the pivot. */
  dir: Vec3;
  x: number;
  y: number;
  /** Toward the viewer: larger is nearer. */
  depth: number;
  /** Balls 1; dots fade with the near-side rule and the reveal. */
  alpha: number;
  ball?: AxisBall;
}>;

export type ScreenPoint = Readonly<{ x: number; y: number; depth: number }>;

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

export const BALL_ARM = 0.8;
export const BALL_RADIUS = 0.16;
export const DOT_RADIUS = 0.06;
const DOT_HIT_RADIUS = 0.1;
const BALL_HIT_SLACK = 0.02;

/** The cube's north marker: its distance from the centre and its chip edge. */
export const MARKER_DISTANCE = 1.16;
export const MARKER_CHIP = 0.24;
/** The marker's pointer triangle: tip just short of the chip, base nearer the cube. */
const POINTER_TIP = MARKER_DISTANCE - MARKER_CHIP / 2 - 0.03;
const POINTER_BASE = POINTER_TIP - 0.16;
const POINTER_HALF_WIDTH = 0.08;

/** How far each drawing reaches from the centre (sizes the mini viewport). */
export const AXIS_REACH = BALL_ARM + BALL_RADIUS + 0.08;
export const MARKER_REACH = MARKER_DISTANCE + MARKER_CHIP / 2 + 0.08;

/** A dot fades in from this facing (its direction · toward-viewer) to full at DOT_FACING_FULL. */
const DOT_FACING_MIN = 0.12;
const DOT_FACING_FULL = 0.45;
/** The dot this close to the current view is where the camera already is. */
const DOT_HIDE_NEAR_VIEW = Math.cos((8 * Math.PI) / 180);
/** Fainter dots than this are neither clickable nor worth hovering. */
export const DOT_PICK_MIN_ALPHA = 0.35;

const FACE_DIR: Record<GizmoFace, Vec3> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
};

export const AXIS_BALLS: readonly AxisBall[] = [
  { face: 'right', axis: 'X', sign: 1 },
  { face: 'left', axis: 'X', sign: -1 },
  { face: 'back', axis: 'Y', sign: 1 },
  { face: 'front', axis: 'Y', sign: -1 },
  { face: 'top', axis: 'Z', sign: 1 },
  { face: 'bottom', axis: 'Z', sign: -1 },
];

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function norm3(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The gizmo's screen axes from the camera quaternion: the columns of R(q),
 *  the same projection ViewCubePass and the DOM cube use. */
export function basisFromQuat(q: Quat): GizmoBasis {
  const { x, y, z, w } = q;
  return {
    right: [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    up: [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    back: [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  };
}

/** Where a world-space point (cube-edge units) lands on the gizmo, y down. */
export function projectPoint(basis: GizmoBasis, p: Vec3): ScreenPoint {
  return { x: dot3(p, basis.right), y: -dot3(p, basis.up), depth: dot3(p, basis.back) };
}

/** A unit world direction for each face (the axis balls' directions). */
export function faceDirection(face: GizmoFace): Vec3 {
  return FACE_DIR[face];
}

/**
 * The in-between views as unit directions: the 4 horizontal 45° views and
 * the 8 iso corners ('iso'), plus the 8 tilted 45° views for 'all' — the
 * cube's edges and corners in ball form.
 */
export function snapDirections(set: SnapDotSet): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        const nonZero = Number(x !== 0) + Number(y !== 0) + Number(z !== 0);
        const isTilted45 = nonZero === 2 && z !== 0;
        if (nonZero < 2 || (isTilted45 && set === 'iso')) {
          continue;
        }
        out.push(norm3([x, y, z]));
      }
    }
  }
  return out;
}

/** A dot's opacity from how much it faces the viewer: only the near half shows,
 *  and not the view the camera already has. */
export function dotAlpha(facing: number): number {
  if (facing > DOT_HIDE_NEAR_VIEW) {
    return 0;
  }
  return Math.min(1, Math.max(0, (facing - DOT_FACING_MIN) / (DOT_FACING_FULL - DOT_FACING_MIN)));
}

function dotId(d: Vec3): string {
  return `dot:${d.map((v) => Math.sign(Math.round(v * 10))).join(',')}`;
}

// -----------------------------------------------------------------------------
// layout + picking
// -----------------------------------------------------------------------------

/**
 * The balls (and the snap dots when `snapDots` is set) laid out for one view,
 * sorted back to front for painting. `reveal` (0..1) scales the dots: 0 while
 * the pointer is away, so only the six balls show.
 */
export function layoutAxisGizmo(basis: GizmoBasis, snapDots: SnapDotSet | null, reveal: number): AxisItem[] {
  const items: AxisItem[] = [];
  for (const ball of AXIS_BALLS) {
    const dir = FACE_DIR[ball.face];
    const p = projectPoint(basis, [dir[0] * BALL_ARM, dir[1] * BALL_ARM, dir[2] * BALL_ARM]);
    items.push({ kind: 'ball', id: `ball:${ball.face}`, dir, x: p.x, y: p.y, depth: p.depth, alpha: 1, ball });
  }
  if (snapDots && reveal > 0) {
    for (const dir of snapDirections(snapDots)) {
      const alpha = dotAlpha(dot3(dir, basis.back)) * reveal;
      if (alpha <= 0) {
        continue;
      }
      const p = projectPoint(basis, [dir[0] * BALL_ARM, dir[1] * BALL_ARM, dir[2] * BALL_ARM]);
      items.push({ kind: 'dot', id: dotId(dir), dir, x: p.x, y: p.y, depth: p.depth, alpha });
    }
  }
  return items.sort((a, b) => a.depth - b.depth);
}

/** The item under a gizmo-space point, nearest first; faint dots don't count. */
export function pickAxisGizmo(items: readonly AxisItem[], x: number, y: number): AxisItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const isDot = it.kind === 'dot';
    if (isDot && it.alpha < DOT_PICK_MIN_ALPHA) {
      continue;
    }
    const r = isDot ? DOT_HIT_RADIUS : BALL_RADIUS + BALL_HIT_SLACK;
    if (Math.hypot(x - it.x, y - it.y) <= r) {
      return it;
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// true north (the cube's marker)
// -----------------------------------------------------------------------------

/** An angle in degrees wrapped to (−180, 180]. */
export function wrapDegrees(deg: number): number {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

/** True north as a unit ground direction: +Y turned clockwise (seen from above) by `angleDeg`. */
export function northDirection(angleDeg: number): Vec3 {
  const t = (angleDeg * Math.PI) / 180;
  return [Math.sin(t), Math.cos(t), 0];
}

/** Where the cube's north marker sits on the gizmo for this view. */
export function northMarkerPoint(basis: GizmoBasis, angleDeg: number): ScreenPoint {
  const n = northDirection(angleDeg);
  return projectPoint(basis, [n[0] * MARKER_DISTANCE, n[1] * MARKER_DISTANCE, 0]);
}

/**
 * The marker's pointer: a flat triangle lying in the ground plane between
 * the cube and the N chip, its tip aimed at true north — tip first, then the
 * two base corners. Seen from above it points straight at north; seen from
 * the side it flattens like the ground does.
 */
export function northPointer(basis: GizmoBasis, angleDeg: number): readonly [ScreenPoint, ScreenPoint, ScreenPoint] {
  const n = northDirection(angleDeg);
  const side: Vec3 = [n[1], -n[0], 0];
  const at = (along: number, across: number): ScreenPoint =>
    projectPoint(basis, [n[0] * along + side[0] * across, n[1] * along + side[1] * across, 0]);
  return [at(POINTER_TIP, 0), at(POINTER_BASE, -POINTER_HALF_WIDTH), at(POINTER_BASE, POINTER_HALF_WIDTH)];
}
