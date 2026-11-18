// Where a click on the navigation gizmo sends the camera: a pure mapping from
// the picked direction (+ the settings that shape it) to the turntable
// camera's azimuth/elevation, so the rules are unit tested apart from the DOM.
import { northDirection, type Vec3 } from './axisGizmo';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** Clicking an axis ball: view from that side (as the cube does), or look toward it. */
export type BallClick = 'viewFrom' | 'lookToward';

/** Heading after a straight-down/up snap: keep it, model +Y up, or true north up. */
export type TopViewHeading = 'keep' | 'model' | 'north';

export type GizmoSnapInput = Readonly<{
  /** Cube plates and snap dots put the camera on their side; balls and the
   *  north marker follow `ballClick` and flip when already there. */
  kind: 'face' | 'edge' | 'corner' | 'snap' | 'ball' | 'north';
  /** Unit world direction of the picked item, from the pivot. */
  direction: Vec3;
  /** Shift held: take the opposite view. */
  isShift: boolean;
  ballClick: BallClick;
  topViewHeading: TopViewHeading;
  /** Degrees clockwise from +Y (seen from above) — for the 'north' heading. */
  northAngle: number;
  /** The camera now: its azimuth and look direction (camera → target). */
  azimuth: number;
  forward: Vec3;
}>;

export type GizmoSnapTarget = Readonly<{ azimuth: number; elevation: number }>;

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Below this horizontal length a direction counts as straight up/down. */
const VERTICAL_EPS = 1e-3;
/** Within this angle the camera already looks from a direction. */
const SAME_VIEW_COS = Math.cos((1 * Math.PI) / 180);
/** The model's own "up the screen" for a top view: +Y, its BACK side. */
const MODEL_UP: Vec3 = [0, 1, 0];

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const opposite = (d: Vec3): Vec3 => [-d[0], -d[1], -d[2]];

/** True when the camera already sits along `eyeDir` (pivot → eye). */
export function isLookingFrom(forward: Vec3, eyeDir: Vec3): boolean {
  const l = Math.hypot(eyeDir[0], eyeDir[1], eyeDir[2]) || 1;
  const d = -(forward[0] * eyeDir[0] + forward[1] * eyeDir[1] + forward[2] * eyeDir[2]) / l;
  return d > SAME_VIEW_COS;
}

/**
 * A straight-down or straight-up view has no azimuth of its own. 'keep'
 * holds the current one (the camera only pitches). Otherwise the chosen
 * "up" (+Y, or true north) goes to the top of the screen: looking down the
 * screen's up is the heading itself, looking up it is the reverse — a true
 * view from below, never a mirror image.
 */
function verticalAzimuth(input: GizmoSnapInput, isLookingDown: boolean): number {
  if (input.topViewHeading === 'keep') {
    return input.azimuth;
  }
  const up = input.topViewHeading === 'north' ? northDirection(input.northAngle) : MODEL_UP;
  return isLookingDown ? Math.atan2(up[1], up[0]) : Math.atan2(-up[1], -up[0]);
}

// -----------------------------------------------------------------------------
// snap
// -----------------------------------------------------------------------------

/** The camera azimuth/elevation a gizmo pick snaps to (feed camera.snapView). */
export function gizmoSnapTarget(input: GizmoSnapInput): GizmoSnapTarget {
  const d = input.direction;
  let eye: Vec3;
  if (input.kind === 'ball' || input.kind === 'north') {
    const chosen = input.ballClick === 'viewFrom' ? d : opposite(d);
    eye = input.isShift || isLookingFrom(input.forward, chosen) ? opposite(chosen) : chosen;
  } else {
    eye = input.isShift ? opposite(d) : d;
  }
  const isVertical = Math.hypot(eye[0], eye[1]) < VERTICAL_EPS;
  // the camera sits along +eye looking back at the pivot: forward = −eye
  const azimuth = isVertical ? verticalAzimuth(input, eye[2] > 0) : Math.atan2(-eye[1], -eye[0]);
  const elevation = Math.asin(Math.max(-1, Math.min(1, -eye[2])));
  return { azimuth, elevation };
}
