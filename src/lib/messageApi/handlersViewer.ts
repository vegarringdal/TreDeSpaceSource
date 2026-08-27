// Viewer-control commands: MultiColor rules, view state (sketch/screenshot),
// clipping and navigation. See EVENTS.md for the payload contracts.
import { multiColorActions } from '../../components/panels/multi-color/multiColor.actions';
import { multiColorState, normalizeRules } from '../../components/panels/multi-color/multiColor.state';
import { ribbonClippingBoxActions } from '../../components/panels/ribbon-clipping-box/ribbonClippingBox.actions';
import { ribbonHomeActions } from '../../components/panels/ribbon-home/ribbonHome.actions';
import { clipShapesActions } from '../../state/viewer/clipShapes.actions';
import { getRenderer, viewerActions } from '../../state/viewer/viewer.actions';
import { viewerState } from '../../state/viewer/viewer.state';
import { ApiError, type ApiHandler, records } from './protocol';

const setOrAddColorRules: ApiHandler = async ({ type, p }) => {
  const incoming = normalizeRules(p.rules);
  if (!incoming.length) {
    throw new ApiError('bad-payload', 'rules must be a non-empty rule[]');
  }
  const cur = multiColorState.get();
  const rules = type === 'colorRules.add' ? [...cur.rules, ...incoming] : incoming;
  const mode = p.mode === 'append' || p.mode === 'hide' ? p.mode : type === 'colorRules.add' ? cur.mode : 'reset';
  multiColorState.set({ mode, rules, counts: [] });
  let ran = false;
  if (p.run === true) {
    await multiColorActions.run();
    ran = true;
  }
  return { rules: rules.length, ran, matches: multiColorState.get().counts.map((c) => c ?? 0) };
};

// -----------------------------------------------------------------------------
// camera
// -----------------------------------------------------------------------------

/** The camera is ORBIT-based (Z-up): a pivot `target`, plus `azimuth` /
 *  `elevation` (radians) and the `distance` from the pivot. Hosts usually
 *  think in eye positions, so a payload may give `position` + `target`
 *  instead and this converts. Fields left out keep their current value. */
type CameraPose = { target: [number, number, number]; azimuth: number; elevation: number; distance: number };

function vec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) {
    return null;
  }
  const n = v.map(Number);
  return n.every((x) => Number.isFinite(x)) ? [n[0], n[1], n[2]] : null;
}

function poseFromPayload(p: Record<string, unknown>): CameraPose | null {
  const cam = getRenderer()?.camera;
  if (!cam) {
    return null;
  }
  const target = vec3(p.target) ?? [cam.target[0], cam.target[1], cam.target[2]];
  const position = vec3(p.position);
  if (position) {
    // forward runs eye → target: distance is its length, azimuth/elevation
    // its spherical angles (elevation +Z up, matching the render camera)
    const d: [number, number, number] = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
    const distance = Math.hypot(d[0], d[1], d[2]);
    if (distance < 1e-6) {
      throw new ApiError('bad-payload', 'position and target must not be the same point');
    }
    return { target, azimuth: Math.atan2(d[1], d[0]), elevation: Math.asin(d[2] / distance), distance };
  }
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    target,
    azimuth: num(p.azimuth, cam.azimuth),
    elevation: num(p.elevation, cam.elevation),
    distance: Math.max(num(p.distance, cam.orbitDistance), 0.05),
  };
}

/** Move the camera per a payload and resolve once it has ARRIVED (the move
 *  is an animation the render loop drives — resolving earlier let a load
 *  start, or a command respond, mid-flight). Returns the applied pose, or null
 *  when the renderer is not up yet. `animate: false` snaps instead of
 *  gliding. Shared with the asset-load commands, where a `camera` replaces
 *  their `fit`; marking the view as chosen keeps the first-model default view
 *  from overriding it. */
export async function applyCameraPayload(p: Record<string, unknown>): Promise<CameraPose | null> {
  const r = getRenderer();
  const cam = r?.camera;
  const pose = poseFromPayload(p);
  if (!r || !cam || !pose) {
    return null;
  }
  if (typeof p.orthographic === 'boolean') {
    viewerActions.setProjection(p.orthographic);
  }
  r.markViewChosen();
  cam.goToPose(pose.target, pose.azimuth, pose.elevation, pose.distance, p.animate === false ? 0.01 : 0.5);
  await cam.settled();
  return pose;
}

export const viewerHandlers: Record<string, ApiHandler> = {
  'colorRules.set': setOrAddColorRules,
  'colorRules.add': setOrAddColorRules,

  'colorRules.run': async () => {
    await multiColorActions.run();
    return { matches: multiColorState.get().counts.map((c) => c ?? 0) };
  },

  'colorRules.clear': () => {
    multiColorState.set({ rules: [], counts: [] });
    return {};
  },

  // the Alt+R "reset colors" action
  'colorRules.resetModel': async () => {
    await viewerActions.clearAllOverrides();
    return {};
  },

  'settings.get': () => ({ version: __APP_VERSION__, viewer: viewerState.get() }),

  // Toggle when `on` is omitted; set explicitly when a boolean is given.
  'view.sketch': ({ p }) => {
    const on = typeof p.on === 'boolean' ? p.on : !viewerState.get().sketch;
    viewerActions.update({ sketch: on });
    return { sketch: on };
  },

  'view.screenshot': async () => {
    // capture the converged frame + overlays and hand the host a PNG data URL
    // (usable straight as an <img> src or download href — no bytes to detach)
    const shot = await ribbonHomeActions.captureScreenshotBlob();
    if (!shot) {
      throw new ApiError('internal', 'no renderer to capture');
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error ?? new Error('failed to encode PNG'));
      fr.readAsDataURL(shot.blob);
    });
    return { dataUrl, width: shot.width, height: shot.height };
  },

  'clip.box.fitSelected': async ({ p }) => {
    // offset margin is per-call only — it does NOT change the panel's stored
    // Fit-Sel offset
    const offset = typeof p.offset === 'number' ? p.offset : 0;
    await ribbonClippingBoxActions.fitSel(offset);
    return { offset };
  },

  'clip.shapes.add': ({ p }) => {
    const shapes = records(p.shapes, 'shapes') as Parameters<typeof clipShapesActions.addShapes>[0];
    return { added: clipShapesActions.addShapes(shapes) };
  },

  'clip.box.disable': () => {
    ribbonClippingBoxActions.disable();
    return {};
  },

  // disable box clipping AND remove every clip shape
  'clip.reset': () => {
    ribbonClippingBoxActions.disable();
    clipShapesActions.clear();
    return {};
  },

  'camera.get': () => {
    const cam = getRenderer()?.camera;
    if (!cam) {
      throw new ApiError('not-found', 'the renderer is not up yet');
    }
    return {
      target: [cam.target[0], cam.target[1], cam.target[2]],
      position: cam.eye(),
      azimuth: cam.azimuth,
      elevation: cam.elevation,
      distance: cam.orbitDistance,
      orthographic: viewerState.get().orthographic,
    };
  },

  'camera.set': async ({ p }) => {
    const pose = await applyCameraPayload(p);
    if (!pose) {
      throw new ApiError('not-found', 'the renderer is not up yet');
    }
    return pose;
  },

  'nav.flyTo': async ({ p }) => {
    const fullname = typeof p.fullname === 'string' ? p.fullname : '';
    if (!fullname) {
      throw new ApiError('bad-payload', 'fullname is required');
    }
    return { matched: await viewerActions.flyToFullname(fullname, p.select === true) };
  },

  'nav.orbit': async ({ p }) => {
    const fullname = typeof p.fullname === 'string' ? p.fullname : '';
    if (!fullname) {
      throw new ApiError('bad-payload', 'fullname is required');
    }
    return { matched: await viewerActions.orbitFullname(fullname, p.select === true) };
  },
};
