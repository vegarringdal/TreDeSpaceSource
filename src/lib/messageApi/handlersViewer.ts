// Viewer-control commands: MultiColor rules, view state (sketch/screenshot),
// clipping and navigation. See EVENTS.md for the payload contracts.
import { multiColorActions } from '../../components/panels/multi-color/multiColor.actions';
import { multiColorState, normalizeRules } from '../../components/panels/multi-color/multiColor.state';
import { ribbonClippingBoxActions } from '../../components/panels/ribbon-clipping-box/ribbonClippingBox.actions';
import { ribbonHomeActions } from '../../components/panels/ribbon-home/ribbonHome.actions';
import { clipShapesActions } from '../../state/viewer/clipShapes.actions';
import { viewerActions } from '../../state/viewer/viewer.actions';
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
