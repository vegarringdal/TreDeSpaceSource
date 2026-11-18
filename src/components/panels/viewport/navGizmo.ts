// The viewport's navigation gizmo: the DOM hit layer (ViewGizmo: cube plates
// or axis balls, drag handle, switch gesture), the renderer that draws it
// (so canvas captures include it), the camera snap on a pick, and the
// settings that shape it (Settings → Gizmo, settings.gizmo.set).

import { type GizmoPick, ViewGizmo } from '../../../lib/overlay/ViewGizmo';
import { type NavGizmoStyle, type Quat, type SnapDotSet, wrapDegrees } from '../../../lib/render/axisGizmo';
import { type BallClick, gizmoSnapTarget, type TopViewHeading } from '../../../lib/render/gizmoSnap';
import type { Renderer } from '../../../lib/render/renderer';
import { buildViewCubeGeometry } from '../../../lib/render/viewCubeGpu';
import { faceLetters, gizmoLabelsState } from '../../../state/viewer/gizmoLabels.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { initialViewerState, viewerState } from '../../../state/viewer/viewer.state';
import { enumOr } from '../../../state/viewer/viewerSettingsGroups';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

type NavSettings = Readonly<{
  style: NavGizmoStyle;
  snapDots: SnapDotSet;
  ballClick: BallClick;
  topViewHeading: TopViewHeading;
  northAngle: number;
  isMarkerOn: boolean;
}>;

export interface NavGizmo {
  /** Re-read the gizmo settings (call when viewer state changed). */
  applyOptions(): void;
  /** Before the frame: placement, hover and the dots' reveal for the renderer. */
  beforeFrame(now: number): void;
  /** After the frame: turn the DOM hit zones with the camera. */
  afterFrame(): void;
  dispose(): void;
}

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const SNAP_SECONDS = 0.35;
const PLATE_KINDS = new Set<GizmoPick['kind']>(['face', 'edge', 'corner']);

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Camera world-orientation quaternion (columns right/up/back) for the gizmo. */
function cameraQuat(fwd: readonly [number, number, number]): Quat {
  const rl = Math.hypot(fwd[0], fwd[1]) || 1;
  const r = [fwd[1] / rl, -fwd[0] / rl, 0];
  const u = [r[1] * fwd[2], -r[0] * fwd[2], r[0] * fwd[1] - r[1] * fwd[0]];
  const b = [-fwd[0], -fwd[1], -fwd[2]];
  const m00 = r[0],
    m01 = u[0],
    m02 = b[0];
  const m10 = r[1],
    m11 = u[1],
    m12 = b[1];
  const m20 = r[2],
    m21 = u[2],
    m22 = b[2];
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = s / 4;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = s / 4;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = s / 4;
  }
  return { x, y, z, w };
}

/**
 * The gizmo settings as used here. Stored settings and settings files are not
 * validated on load, so anything out of range falls back to its default
 * rather than letting the drawing and the hit layer disagree.
 */
function readNavSettings(): NavSettings {
  const s = viewerState.get();
  const d = initialViewerState;
  return {
    style: enumOr('gizmoStyle', s.gizmoStyle, d.gizmoStyle),
    snapDots: enumOr('gizmoSnapDots', s.gizmoSnapDots, d.gizmoSnapDots),
    ballClick: enumOr('gizmoBallClick', s.gizmoBallClick, d.gizmoBallClick),
    topViewHeading: enumOr('topViewHeading', s.topViewHeading, d.topViewHeading),
    northAngle: Number.isFinite(s.northAngle) ? wrapDegrees(s.northAngle) : d.northAngle,
    isMarkerOn: typeof s.gizmoNorthMarker === 'boolean' ? s.gizmoNorthMarker : d.gizmoNorthMarker,
  };
}

// -----------------------------------------------------------------------------
// gizmo
// -----------------------------------------------------------------------------

/** Mount the navigation gizmo in `host` (bottom-right, draggable) for `renderer`. */
export function attachNavGizmo(host: HTMLElement, renderer: Renderer): NavGizmo {
  const cubeZones = buildViewCubeGeometry().zoneIds; // pick.id → zone id
  let cubeHover = -1;
  let navHover = '';
  let quat = cameraQuat(renderer.camera.forward());

  const handlePick = (pick: GizmoPick) => {
    const s = readNavSettings();
    const target = gizmoSnapTarget({
      kind: pick.kind,
      direction: pick.direction,
      isShift: pick.isShift === true,
      ballClick: s.ballClick,
      topViewHeading: s.topViewHeading,
      northAngle: s.northAngle,
      azimuth: renderer.camera.azimuth,
      forward: renderer.camera.forward(),
    });
    renderer.camera.snapView(target.azimuth, target.elevation, SNAP_SECONDS);
  };
  const handleHover = (pick: GizmoPick | null) => {
    const isPlate = pick !== null && PLATE_KINDS.has(pick.kind);
    cubeHover = isPlate ? (cubeZones[pick.id] ?? -1) : -1;
    // balls and dots hover by their layout id ('ball:back', 'dot:1,-1,1'), the marker as 'north'
    navHover = pick && !isPlate ? pick.id : '';
  };
  const handleToggleStyle = () => {
    viewerActions.update({ gizmoStyle: readNavSettings().style === 'cube' ? 'balls' : 'cube' });
  };

  // The gizmo is DRAWN by the renderer (GPU overlay — so canvas captures
  // include it); the DOM ViewGizmo stays as invisible hit zones + handle.
  const gizmo = new ViewGizmo(host, {
    visual: false,
    // bottom-right by default (it stays draggable via its handle)
    position: { right: 12, bottom: 12 },
    onPick: handlePick,
    onHover: handleHover,
    onToggleStyle: handleToggleStyle,
    onOrbit: (dx, dy) => renderer.camera.orbitBy(dx, dy),
  });

  /** Style, letters, snap dots and the cube's north marker, to the renderer and the hit layer. */
  const applyOptions = () => {
    const s = readNavSettings();
    const letters = faceLetters(gizmoLabelsState.get().labels);
    // the cube's north marker: always an N with its pointer when switched on (never on the balls)
    const isMarkerShown = s.style === 'cube' && s.isMarkerOn;
    renderer.setNavGizmo({
      style: s.style,
      snapDots: s.snapDots,
      letters,
      northAngle: s.northAngle,
      northMarker: isMarkerShown,
    });
    gizmo.setStyle(s.style);
    gizmo.setSnapDots(s.snapDots);
    gizmo.setNorthMarker(isMarkerShown ? s.northAngle : null);
  };
  const applyLabels = () => {
    renderer.setViewCubeLabels({ ...gizmoLabelsState.get().labels });
    applyOptions();
  };
  applyLabels();
  const unsubLabels = gizmoLabelsState.subscribe(applyLabels);

  return {
    applyOptions,
    beforeFrame(now) {
      quat = cameraQuat(renderer.camera.forward());
      renderer.setViewCube(gizmo.getRect(), cubeHover, quat);
      renderer.setNavGizmoHover(navHover, gizmo.isDotsRevealed(now));
    },
    afterFrame() {
      gizmo.update(quat);
    },
    dispose() {
      unsubLabels();
      gizmo.dispose();
    },
  };
}
