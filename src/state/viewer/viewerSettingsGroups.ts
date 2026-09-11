// The viewer-settings keys each Settings section owns, as one list per
// section — the Settings panel's per-section reset buttons and the host
// API's per-tab setters (`settings.<tab>.set`) both read them, so "what does
// the Rendering tab cover" is answered in exactly one place. Pure module: a
// type-only import of the state shape, no store, so unit tests can load it.
import type { ViewerState } from './viewer.state';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Keep the literal key union (a plain array literal widens to keyof ViewerState). */
function keys<K extends keyof ViewerState>(...list: K[]): readonly K[] {
  return list;
}

/** The subset of `state` under `keys` — a section's or tab's current values. */
export function pickViewer<K extends keyof ViewerState>(state: ViewerState, keys: readonly K[]): Pick<ViewerState, K> {
  const out: Partial<Pick<ViewerState, K>> = {};
  for (const k of keys) {
    out[k] = state[k];
  }
  // every key was just assigned, so the partial is complete
  return out as Pick<ViewerState, K>;
}

// -----------------------------------------------------------------------------
// sections (one per collapsible in the Settings panel)
// -----------------------------------------------------------------------------

export const VIEWER_SECTION_KEYS = {
  antialiasing: keys('fastAA', 'aaSamples', 'msaa4x', 'pixelRatio', 'useDevicePixelRatio', 'smartPixelRatio'),
  culling: keys('fpsLimit', 'freezeCull', 'protectDist', 'pxCut', 'pxCutEnabled', 'vertexPull'),
  picking: keys('pickOpacityPct'),
  vramBudget: keys(
    'vramBudgetOn',
    'maxVramMb',
    'vramSwapSpeed',
    'vramDebugBoxes',
    'vramCutSizeM',
    'vramCutDistM',
    'vramDropHidden',
    'vramActivityHud',
    'vramHoldAccum',
  ),
  selection: keys('bgColor', 'selectionColor', 'selectionStyle'),
  outline: keys(
    'outlineHover',
    'outlineStrength',
    'outlineGlow',
    'outlineThickness',
    'outlinePulse',
    'outlineVisibleColor',
    'outlineHiddenColor',
  ),
  transparency: keys('transparencyBlend', 'transparencyBackdrop', 'backdropFadePct'),
  darkColors: keys('darkLift', 'darkLiftPct'),
  debug: keys('meshletVis', 'debugBuf'),
  lighting: keys('ambientColor', 'ambientIntensity', 'headlightColor', 'headlightIntensity'),
  sketchLighting: keys(
    'sketchAmbientColor',
    'sketchAmbientIntensity',
    'sketchHeadlightColor',
    'sketchHeadlightIntensity',
  ),
  edgesCommon: keys('geoEdges', 'itemEdges', 'edgeColor', 'whiteOnDark', 'darkThr'),
  edgesFlat: keys('flatMeshEdges', 'fadeExp', 'depthThr', 'normalThr'),
  edgesSmooth: keys('smoothMeshEdges', 'smoothFadeExp', 'smoothDepthThr', 'smoothNormalThr'),
  sketchEdges: keys(
    'sketchEdgeColor',
    'sketchFadeExp',
    'sketchDepthThr',
    'sketchNormalThr',
    'sketchRespectsEdgesOff',
    'sketchColorMode',
    'sketchCubeFaceColor',
    'sketchCubeLineColor',
    'sketchCubeTextColor',
    'sketchCubeHoverColor',
  ),
  ao: keys('aoMode', 'aoRadius', 'aoStrength', 'aoSlices', 'aoSamples'),
  cubeColors: keys('cubeFaceColor', 'cubeLineColor', 'cubeTextColor', 'cubeHoverColor'),
  stats: keys('showStats', 'statsHidden', 'statsBackdrop', 'gpuTimings', 'trace'),
};

// -----------------------------------------------------------------------------
// tabs (what one `settings.<tab>.set` command covers)
// -----------------------------------------------------------------------------

const S = VIEWER_SECTION_KEYS;

export const SETTINGS_TAB_KEYS = {
  rendering: [
    ...S.antialiasing,
    ...S.culling,
    ...S.picking,
    ...S.vramBudget,
    ...S.selection,
    ...S.outline,
    ...S.transparency,
    ...S.darkColors,
    ...S.debug,
  ],
  lighting: [...S.lighting, ...S.sketchLighting],
  edges: [...S.edgesCommon, ...S.edgesFlat, ...S.edgesSmooth, ...S.sketchEdges],
  ao: [...S.ao],
  /** the Gizmo tab's viewer-state part; its face names live in gizmoLabels.state */
  gizmo: [...S.cubeColors],
};

// -----------------------------------------------------------------------------
// value domains the API validates against
// -----------------------------------------------------------------------------

/** The string/number-literal settings and their allowed values. `satisfies`
 *  keeps each list inside its union; adding a NEW member to a union means
 *  adding it here too (nothing enforces exhaustiveness the other way). */
export const VIEWER_ENUM_VALUES = {
  aoMode: [0, 1, 2],
  debugBuf: [0, 1, 2, 3, 4, 5],
  selectionStyle: ['tint', 'outline', 'both'],
  sketchColorMode: ['off', 'fill', 'edges'],
  vramSwapSpeed: ['relaxed', 'normal', 'fast'],
} as const satisfies { [K in ViewerEnumKey]: readonly ViewerState[K][] };

export type ViewerEnumKey = 'aoMode' | 'debugBuf' | 'selectionStyle' | 'sketchColorMode' | 'vramSwapSpeed';

export function isViewerEnumKey(k: string): k is ViewerEnumKey {
  return k in VIEWER_ENUM_VALUES;
}
