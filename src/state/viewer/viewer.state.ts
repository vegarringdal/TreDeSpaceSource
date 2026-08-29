import { createStore } from '@treDeSpaceUI/lib/createStore';

/**
 * Everything the WebGPU viewer renders with — mirrors Renderer.options plus
 * the projection. The viewport panel copies this into the renderer each frame;
 * the ribbon and Settings panel are the writers (via viewerActions).
 */
/** Sketch colour-from-mesh: off = paper + ink only, fill = mesh colours
 *  washed onto the paper, edges = the ink takes the mesh colour. */
export type SketchColorMode = 'off' | 'fill' | 'edges';

export interface ViewerState {
  orthographic: boolean;
  /** Cull+draw via vertex pulling (core WebGPU, no MDI flag needed). */
  vertexPull: boolean;
  // rendering
  meshletVis: boolean;
  pxCut: number; // 0 = off; pixels, applied while the camera moves
  pxCutEnabled: boolean;
  protectDist: number;
  /** pick threshold %: items at/above are clickable; below pass through (Shift inverts) */
  pickOpacityPct: number;
  fastAA: boolean; // accumulation TAA
  msaa4x: boolean;
  freezeCull: boolean;
  /** Render scale (canvas px per CSS px). Ignored when useDevicePixelRatio. */
  pixelRatio: number;
  /** Follow window.devicePixelRatio instead of the fixed pixelRatio. */
  useDevicePixelRatio: boolean;
  /** Smart render scale (overrides both fields above): mobile devices render
   *  at 1 (integer-DPR upscale stays uniform), desktops at the native device
   *  pixel ratio — fractional Windows scaling (125/150%) otherwise shreds the
   *  1px edge lines. */
  smartPixelRatio: boolean;
  // edges
  geoEdges: boolean;
  itemEdges: boolean;
  /** Sketch mode: white background, black edge lines only (technical drawing). */
  sketch: boolean;
  // sketch mode's OWN edge tuning (replaces the normal edge params while on)
  sketchEdgeColor: string;
  sketchFadeExp: number;
  sketchDepthThr: number;
  sketchNormalThr: number;
  // view cube (gizmo cube) colors — sketch mode has its own set
  cubeFaceColor: string;
  cubeLineColor: string;
  cubeTextColor: string;
  cubeHoverColor: string;
  sketchCubeFaceColor: string;
  sketchCubeLineColor: string;
  sketchCubeTextColor: string;
  sketchCubeHoverColor: string;
  edgeColor: string; // hex, e.g. "#000000"
  fadeExp: number;
  depthThr: number;
  normalThr: number;
  whiteOnDark: boolean;
  darkThr: number;
  // separate edge tuning for meshes with AUTHORED normals (smooth shading)
  smoothFadeExp: number;
  smoothDepthThr: number;
  smoothNormalThr: number;
  /** Edge lines on flat-shaded meshes (global category switch). */
  flatMeshEdges: boolean;
  /** Edge lines on meshes with authored normals (global category switch). */
  smoothMeshEdges: boolean;
  /** Sketch mode honors the edge-off switches (default: sketch always draws). */
  sketchRespectsEdgesOff: boolean;
  /** sketch colour-from-mesh: 'fill' washes coloured surfaces onto the paper,
   *  'edges' draws the ink in the mesh colour; colourless meshes
   *  (white/grey/black) always stay plain paper + ink */
  sketchColorMode: SketchColorMode;
  // ambient occlusion
  aoMode: 0 | 1 | 2; // off / motion / static
  aoRadius: number;
  aoStrength: number;
  aoSlices: number;
  aoSamples: number;
  // lighting (native LightingSettings)
  ambientColor: string;
  ambientIntensity: number;
  headlightColor: string;
  headlightIntensity: number;
  // outline effect (three.js OutlinePass style: selection + hover)
  /** Outline the item under the cursor (throttled hover picks). */
  outlineHover: boolean;
  /** How a selection is shown: color tint, outline, or both. */
  selectionStyle: 'tint' | 'outline' | 'both';
  outlineStrength: number; // edge intensity 0-10
  outlineGlow: number; // 0-1 wide soft glow
  outlineThickness: number; // blur radius 1-4 px
  outlinePulse: number; // pulse period seconds, 0 = off
  outlineVisibleColor: string; // hex
  outlineHiddenColor: string; // hex — occluded part of the silhouette
  // rendering misc
  bgColor: string;
  selectionColor: string;
  /** transient: after a color apply the tint hides on colored items */
  suppressTintOnOverride: boolean;
  /** false = alpha hash (converges under TAA), true = unsorted blend pass */
  transparencyBlend: boolean;
  /** transient: any opacity overrides exist (worker-reported) */
  hasTransparency: boolean;
  /** TAA/AO accumulation target */
  aaSamples: number;
  /** Render-loop FPS cap (frames per second). */
  fpsLimit: number;
  /** VRAM budget in MB (0 = off). Over budget, the residency manager demotes
   *  far models to their coarse variant (or unloads legacy assets) while the
   *  camera is idle; under budget it promotes them back. */
  maxVramMb: number;
  /** How aggressively the VRAM budget swaps: pacing preset for idle delay,
   *  swap rate, and re-swap cooldowns. */
  vramSwapSpeed: 'relaxed' | 'normal' | 'fast';
  /** Debug: draw each tracked zone's visible-bounds box colored by residency
   *  (green full / purple mixed / orange coarse / red unloaded / blue swapping). */
  vramDebugBoxes: boolean;
  /** Budget cut: items with every extent below this (meters) AND farther than
   *  vramCutDistM are dropped from budget packs entirely (0 = off). */
  vramCutSizeM: number;
  /** Budget cut: distance (meters) beyond which tiny items are dropped. */
  vramCutDistM: number;
  /** Budget cut: drop hidden items from budget packs (frees their VRAM for
   *  visible detail; they re-pack in on unhide). */
  vramDropHidden: boolean;
  /** Small top-right viewport chip showing what the VRAM budget is doing
   *  (optimizing / settled / waiting) while a budget is active. */
  vramActivityHud: boolean;
  /** First-load view frames the v8 percentile dense bounds (not the full AABB). */
  fitDense: boolean;
  /** On-screen move joystick in the viewport corner (tablet use). */
  touchPads: boolean;
  /** Joystick centre position as a % of the viewport (0 = left/top). */
  joystickX: number;
  joystickY: number;
  debugBuf: 0 | 1 | 2 | 3 | 4 | 5; // off/normal/depth/item id/edge/ao
  // stats
  showStats: boolean;
  /** stat row keys (statsRows.ts) the viewport overlay leaves out — every
   *  row shows by default; unticked in Settings → Stats */
  statsHidden: string[];
  /** dark backdrop behind the overlay text so it reads over bright models */
  statsBackdrop: boolean;
  /** measure per-pass GPU times with timestamp-query (Stats tab) */
  gpuTimings: boolean;
  /** verbose performance tracing to the Console (Stats tab) — dev diagnostic */
  trace: boolean;
}

export const initialViewerState: ViewerState = {
  orthographic: false,
  vertexPull: true,
  meshletVis: false,
  pxCut: 6,
  pxCutEnabled: true,
  protectDist: 15,
  pickOpacityPct: 10.1,
  fastAA: false,
  msaa4x: true,
  freezeCull: false,
  pixelRatio: 1,
  useDevicePixelRatio: false,
  smartPixelRatio: true,
  geoEdges: true,
  itemEdges: true,
  sketch: false,
  sketchEdgeColor: '#000000',
  sketchFadeExp: 0.1,
  sketchDepthThr: 0.075,
  sketchNormalThr: 0.25,
  cubeFaceColor: '#2f3641', // the cube's original palette (shaders.ts BASE_FACE…)
  cubeLineColor: '#4d5665',
  cubeTextColor: '#c9cfd8',
  cubeHoverColor: '#4a6d9c',
  sketchCubeFaceColor: '#ffffff', // paper look to match the sketch background
  sketchCubeLineColor: '#000000',
  sketchCubeTextColor: '#333333',
  sketchCubeHoverColor: '#9e9e9e',
  edgeColor: '#000000',
  fadeExp: 0.3,
  depthThr: 0.01,
  normalThr: 0.25,
  whiteOnDark: true,
  darkThr: 0.07,
  smoothFadeExp: 0.3,
  smoothDepthThr: 0.01,
  smoothNormalThr: 0.25,
  flatMeshEdges: true,
  smoothMeshEdges: true,
  sketchRespectsEdgesOff: false,
  sketchColorMode: 'off',
  // AO off by default: the at-rest accumulation tail is a real cost on weak
  // GPUs (queued full-detail frames delay the next camera move)
  aoMode: 0,
  aoRadius: 0.8,
  aoStrength: 0.15,
  aoSlices: 6,
  aoSamples: 6,
  ambientColor: '#ffffff',
  ambientIntensity: 0.3,
  headlightColor: '#ffffff',
  headlightIntensity: 0.65,
  outlineHover: false,
  selectionStyle: 'tint',
  outlineStrength: 3,
  outlineGlow: 0,
  outlineThickness: 1,
  outlinePulse: 0,
  outlineVisibleColor: '#ffffff',
  outlineHiddenColor: '#190a05', // three.js OutlinePass default
  bgColor: '#8e949f',
  selectionColor: '#2233ff', // dark blue, a touch brighter than pure blue
  suppressTintOnOverride: false,
  transparencyBlend: true,
  hasTransparency: false,
  aaSamples: 32,
  fpsLimit: 30,
  maxVramMb: 0,
  vramSwapSpeed: 'normal',
  vramDebugBoxes: false,
  vramCutSizeM: 0.5,
  vramCutDistM: 200,
  vramDropHidden: true,
  vramActivityHud: true,
  fitDense: true,
  touchPads: false,
  joystickX: 10, // left side, vertically centred by default
  joystickY: 50,
  debugBuf: 0,
  showStats: false, // stats live in Settings → Stats; overlay is opt-in
  statsHidden: [],
  statsBackdrop: true,
  gpuTimings: false,
  trace: false,
};

// persist the viewer/render settings so edits survive a refresh. Transient
// runtime flags AND per-session view modes (camera projection, sketch) are
// excluded from the saved copy: sessions always start perspective/non-sketch,
// and keeping them out lets two instances' persisted blobs converge to
// identical strings — the cross-tab sync's no-echo invariant depends on that
// (differing blobs ping-pong storage events and fight e.g. color-picker drags).
const VIEWER_KEY = 'viewer';
const TRANSIENT: (keyof ViewerState)[] = ['hasTransparency', 'suppressTintOnOverride', 'orthographic', 'sketch'];

function loadViewer(): ViewerState {
  try {
    const raw = localStorage.getItem(VIEWER_KEY);
    if (raw) {
      // camera mode and sketch are per-SESSION view states, not settings: a
      // fresh page always starts perspective with sketch off (a persisted
      // sketch=true on an empty scene is just a confusing white screen)
      return {
        ...initialViewerState,
        ...(JSON.parse(raw) as Partial<ViewerState>),
        orthographic: false,
        sketch: false,
      };
    }
  } catch {
    // fall back to defaults on a corrupt value
  }
  return initialViewerState;
}

export const viewerState = createStore<ViewerState>(loadViewer());

viewerState.subscribe(() => {
  try {
    const s: Record<string, unknown> = { ...viewerState.get() };
    for (const k of TRANSIENT) {
      delete s[k];
    }
    localStorage.setItem(VIEWER_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable — non-fatal
  }
});

export function useViewer(): ViewerState {
  return viewerState.use();
}
