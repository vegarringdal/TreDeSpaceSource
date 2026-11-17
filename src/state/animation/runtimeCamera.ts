// Camera side of the player (DESIGN.md › Animation › Player): follow
// the camera track, capture poses, and the Return blend — static target via
// goToPose, a MOVING track via a smoothstep blend from the frozen user pose
// to the live track pose so it lands on a moving target without a jump. The
// projection / sketch steps keys make are undone on exit; the pose is the
// user's to keep.

import { lerpCamera, smoothstep } from '../../lib/animation/interp';
import type { AnimCamera } from '../../lib/animation/types';
import type { Renderer } from '../../lib/render/renderer';
import { viewerActions } from '../viewer/viewer.actions';
import { viewerState } from '../viewer/viewer.state';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Return-to-animation-view blend length (DESIGN.md › Animation › Player). */
export const RETURN_BLEND_S = 0.6;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

let blend: { from: AnimCamera; t0: number } | null = null;
/** viewer modes a camera key changed this session: the viewer's own value
 *  and the one the key set, so exit can put the viewer's back (D12) */
let modeChanges: { orthographic?: { own: boolean; set: boolean }; sketch?: { own: boolean; set: boolean } } = {};

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** The renderer's current camera as a viewpoint camera. */
export function captureCameraPose(r: Renderer): AnimCamera {
  const c = r.camera;
  return {
    target: [c.target[0], c.target[1], c.target[2]],
    azimuth: c.azimuth,
    elevation: c.elevation,
    orbitDistance: c.orbitDistance,
    orthographic: viewerState.get().orthographic,
    sketch: viewerState.get().sketch,
  };
}

/** Projection / sketch steps of a camera key (only when they change). */
function applyModes(cam: AnimCamera): void {
  const v = viewerState.get();
  if (cam.orthographic !== v.orthographic) {
    modeChanges.orthographic = { own: modeChanges.orthographic?.own ?? v.orthographic, set: cam.orthographic };
    viewerActions.setProjection(cam.orthographic);
  }
  if (cam.sketch !== undefined && cam.sketch !== v.sketch) {
    modeChanges.sketch = { own: modeChanges.sketch?.own ?? v.sketch, set: cam.sketch };
    viewerActions.update({ sketch: cam.sketch });
  }
}

/** Put the camera exactly on `cam` this frame (follow mode). */
export function setCameraPose(r: Renderer, cam: AnimCamera): void {
  r.camera.quietly(() => r.camera.setPose(cam.target, cam.azimuth, cam.elevation, cam.orbitDistance));
  applyModes(cam);
}

/** Animated move to a static pose (entry camera, Return without a track). */
export function flyCameraTo(r: Renderer, cam: AnimCamera, seconds = RETURN_BLEND_S): void {
  r.camera.quietly(() => r.camera.goToPose([...cam.target], cam.azimuth, cam.elevation, cam.orbitDistance, seconds));
  applyModes(cam);
}

/** Start blending from the current (user) pose onto a moving track. */
export function startReturnBlend(r: Renderer, nowMs: number): void {
  blend = { from: captureCameraPose(r), t0: nowMs };
}

export function cancelReturnBlend(): void {
  blend = null;
}

/** The Return blend is still moving the camera (it needs a frame each tick). */
export function isReturnBlending(): boolean {
  return blend !== null;
}

/** Exit: put back the projection / sketch mode camera keys changed — unless
 *  the user changed that mode again since. */
export function restoreCameraModes(): void {
  const v = viewerState.get();
  const { orthographic, sketch } = modeChanges;
  modeChanges = {};
  if (orthographic && v.orthographic === orthographic.set && orthographic.own !== orthographic.set) {
    viewerActions.setProjection(orthographic.own);
  }
  if (sketch && v.sketch === sketch.set && sketch.own !== sketch.set) {
    viewerActions.update({ sketch: sketch.own });
  }
}

/** The camera to show this frame while following `live`: the blend while
 *  it runs, then the track itself. */
export function blendedCamera(live: AnimCamera, nowMs: number): AnimCamera {
  if (!blend) {
    return live;
  }
  const u = (nowMs - blend.t0) / 1000 / RETURN_BLEND_S;
  if (u >= 1) {
    blend = null;
    return live;
  }
  return lerpCamera(blend.from, live, smoothstep(u));
}
