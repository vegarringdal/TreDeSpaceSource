// Settings commands: the read-only snapshot, one setter per Settings tab
// (company defaults rolled out by a host page), and the GPU report. See
// EVENTS.md for the payload contracts.
import type {
  AoSettings,
  EdgesSettings,
  GizmoSettings,
  LightingSettings,
  RenderingSettings,
} from '../../../api/tredespace-client';
import {
  DEFAULT_GIZMO_LABELS,
  type GizmoFaceName,
  gizmoLabelsActions,
  gizmoLabelsState,
  mergeGizmoLabels,
} from '../../state/viewer/gizmoLabels.state';
import { getRenderer, viewerActions } from '../../state/viewer/viewer.actions';
import { initialViewerState, type ViewerState, viewerState } from '../../state/viewer/viewer.state';
import { pickViewer, SETTINGS_TAB_KEYS } from '../../state/viewer/viewerSettingsGroups';
import { probeAdapters, sameAdapter } from '../render/gpuProbe';
import { suggestVramBudgetMb } from '../render/vramHint';
import { ApiError, type ApiHandler, isRecord } from './protocol';
import { validateViewerPatch } from './settingsPatch';

// -----------------------------------------------------------------------------
// SDK parity (compile-time)
// -----------------------------------------------------------------------------

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type TabKey<T extends keyof typeof SETTINGS_TAB_KEYS> = (typeof SETTINGS_TAB_KEYS)[T][number];

/** The copy-paste SDK cannot import the app, so its per-tab interfaces are
 *  written by hand; this pins each one to the tab's key list, and `tsc`
 *  fails the build the moment either side gains or loses a key. */
export const SDK_TAB_PARITY: {
  rendering: Exact<TabKey<'rendering'>, keyof RenderingSettings>;
  lighting: Exact<TabKey<'lighting'>, keyof LightingSettings>;
  edges: Exact<TabKey<'edges'>, keyof EdgesSettings>;
  ao: Exact<TabKey<'ao'>, keyof AoSettings>;
  gizmo: Exact<TabKey<'gizmo'> | 'labels', keyof GizmoSettings>;
} = { rendering: true, lighting: true, edges: true, ao: true, gizmo: true };

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Validate + apply one tab's patch; `reset` returns the tab to defaults
 *  first. Responds with the tab's values after the change (an empty payload
 *  therefore reads). Persists like an edit in the Settings panel. */
function applyViewerPatch<K extends keyof ViewerState>(
  p: Record<string, unknown>,
  keys: readonly K[],
): Pick<ViewerState, K> {
  const r = validateViewerPatch(p, keys, pickViewer(initialViewerState, keys));
  if (!r.ok) {
    throw new ApiError('bad-payload', r.error);
  }
  const patch = r.reset ? { ...pickViewer(initialViewerState, keys), ...r.patch } : r.patch;
  if (Object.keys(patch).length > 0) {
    viewerActions.update(patch);
  }
  return pickViewer(viewerState.get(), keys);
}

function tabSetter<K extends keyof ViewerState>(keys: readonly K[]): ApiHandler {
  return ({ p }) => applyViewerPatch(p, keys);
}

const isFaceName = (k: string): k is GizmoFaceName => k in DEFAULT_GIZMO_LABELS;

/** The gizmo face names from a payload: a partial record of the six faces. */
function faceLabels(v: unknown): Partial<Record<GizmoFaceName, string>> {
  if (!isRecord(v)) {
    throw new ApiError('bad-payload', 'labels must be an object of face → name');
  }
  const out: Partial<Record<GizmoFaceName, string>> = {};
  for (const [face, name] of Object.entries(v)) {
    if (!isFaceName(face)) {
      throw new ApiError(
        'bad-payload',
        `unknown face '${face}' — allowed: ${Object.keys(DEFAULT_GIZMO_LABELS).join(', ')}`,
      );
    }
    if (typeof name !== 'string') {
      throw new ApiError('bad-payload', `labels.${face} must be a string`);
    }
    out[face] = name;
  }
  return out;
}

// -----------------------------------------------------------------------------
// handlers
// -----------------------------------------------------------------------------

export const settingsHandlers: Record<string, ApiHandler> = {
  'settings.get': () => ({ version: __APP_VERSION__, viewer: viewerState.get() }),

  'settings.rendering.set': tabSetter(SETTINGS_TAB_KEYS.rendering),
  'settings.lighting.set': tabSetter(SETTINGS_TAB_KEYS.lighting),
  'settings.edges.set': tabSetter(SETTINGS_TAB_KEYS.edges),
  'settings.ao.set': tabSetter(SETTINGS_TAB_KEYS.ao),

  // the Gizmo tab spans two stores: cube colours (viewer state) + face names
  'settings.gizmo.set': ({ p }) => {
    const { labels, ...rest } = p;
    const names = labels === undefined ? {} : faceLabels(labels);
    const colors = applyViewerPatch(rest, SETTINGS_TAB_KEYS.gizmo);
    if (rest.reset === true) {
      gizmoLabelsActions.reset();
    }
    if (Object.keys(names).length > 0) {
      // an empty name restores that face's default (mergeGizmoLabels skips blanks)
      gizmoLabelsActions.setAll(mergeGizmoLabels({ ...gizmoLabelsState.get().labels, ...names }));
    }
    return { ...colors, labels: gizmoLabelsState.get().labels };
  },

  'gpu.info.get': async () => {
    const r = getRenderer();
    if (!r?.adapterFacts || !r.adapterLimits || !r.adapterHints) {
      throw new ApiError('not-ready', 'renderer not initialised');
    }
    const adapters = await probeAdapters();
    const hp = adapters['high-performance'];
    const lp = adapters['low-power'];
    return {
      active: r.adapterFacts,
      adapters,
      hasMultipleGpus: hp !== null && lp !== null && !sameAdapter(hp, lp),
      features: { multiDrawIndirect: r.multiDraw, timestampQuery: r.gpuTimingSupported },
      cullMode: r.cullMode,
      limits: r.adapterLimits,
      deviceMemoryGb: r.adapterHints.deviceMemoryGb,
      isMobile: r.adapterHints.isMobile,
      suggestedVramBudgetMb: suggestVramBudgetMb(r.adapterHints),
    };
  },
};
