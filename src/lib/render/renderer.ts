// WebGPU renderer: two-pass GPU occlusion culling + multi-draw indexed indirect.
//
// Per model: vertex/index buffers (all color groups concatenated), a MeshletCull
// storage buffer (sphere + cone + draw-record template), two draw-record buffers
// (one per cull pass) and a persistent per-meshlet visibility buffer.
// Draw counts for all models live in ONE buffer at 256-byte-aligned slots so a
// single clearBuffer resets them and a single copy reads them all back for stats.
//
// Frame: clear counts -> cull pass 1 (last-frame-visible, frustum+cone) ->
// render pass 1 -> build HZB depth pyramid -> cull pass 2 (all meshlets,
// + occlusion, updates visibility) -> render pass 2 (newly visible only).
// With fast-AA/edges/MSAA the scene renders into an offscreen target and a
// fullscreen post pass writes the swapchain. Freeze-cull skips all compute and
// re-renders the last frozen draw records with the live camera.
// Fallback without chromium-experimental-multi-draw-indirect: one plain
// drawIndexed per color group, no culling.

import { projectToScreen } from '../math/project';
import type { PackedModel } from '../model/pack';
import { FRAME_SIZE, FRAME_SLOT } from './frameLayout';

/** what the GPU upload needs — the worker keeps itemBounds for itself */
export type GpuPackedModel = Omit<PackedModel, 'itemBounds'>;

import type { GizmoFace } from '../overlay/ViewGizmo';
import { trackDeviceAllocations } from './allocationTracker';
import { CameraController } from './camera';
import type { GpuModel } from './gpuModel';
import { GpuTimings } from './gpuTimings';
import { ItemPickPass } from './itemPickPass';
import { classifySnap, type MeasureProbe, type MeasureSnap } from './measureSnap';
import { OutlinePass } from './outlinePass';
import { cullWgsl, hzbWgsl, lineWgsl, measureSnapWgsl, postWgsl, renderVpWgsl, renderWgsl, vbaoWgsl } from './shaders';
import { ViewCubePass } from './viewCubePass';

export type { MeasureProbe, MeasureSnap } from './measureSnap';

interface PendingPick {
  x: number; // full-res pixel (for unprojection)
  y: number;
  mode: 'pivot' | 'fly' | 'probe' | 'measure'; // probe: record; measure: snap+normal
}

const RECORD_STRIDE = 20; // drawIndexedIndirect: 5 x u32
/** Fixed per-meshlet VRAM regardless of fill: cull 36 + info 32 + vis 4 +
 *  2 × RECORD_STRIDE draw records + 4 full-list. */
const MESHLET_RECORD_BYTES = 116;
const COUNT_SLOT = 256; // storage-binding offset alignment
const MAX_MODELS = 4096;
const PARAMS_SIZE = 224; // CullParams in shaders.ts

// General 4x4 inverse (column-major). Returns null when singular.
function invert4(m: Float32Array): Float32Array | null {
  const inv = new Float32Array(16);
  inv[0] =
    m[5] * m[10] * m[15] -
    m[5] * m[11] * m[14] -
    m[9] * m[6] * m[15] +
    m[9] * m[7] * m[14] +
    m[13] * m[6] * m[11] -
    m[13] * m[7] * m[10];
  inv[4] =
    -m[4] * m[10] * m[15] +
    m[4] * m[11] * m[14] +
    m[8] * m[6] * m[15] -
    m[8] * m[7] * m[14] -
    m[12] * m[6] * m[11] +
    m[12] * m[7] * m[10];
  inv[8] =
    m[4] * m[9] * m[15] -
    m[4] * m[11] * m[13] -
    m[8] * m[5] * m[15] +
    m[8] * m[7] * m[13] +
    m[12] * m[5] * m[11] -
    m[12] * m[7] * m[9];
  inv[12] =
    -m[4] * m[9] * m[14] +
    m[4] * m[10] * m[13] +
    m[8] * m[5] * m[14] -
    m[8] * m[6] * m[13] -
    m[12] * m[5] * m[10] +
    m[12] * m[6] * m[9];
  inv[1] =
    -m[1] * m[10] * m[15] +
    m[1] * m[11] * m[14] +
    m[9] * m[2] * m[15] -
    m[9] * m[3] * m[14] -
    m[13] * m[2] * m[11] +
    m[13] * m[3] * m[10];
  inv[5] =
    m[0] * m[10] * m[15] -
    m[0] * m[11] * m[14] -
    m[8] * m[2] * m[15] +
    m[8] * m[3] * m[14] +
    m[12] * m[2] * m[11] -
    m[12] * m[3] * m[10];
  inv[9] =
    -m[0] * m[9] * m[15] +
    m[0] * m[11] * m[13] +
    m[8] * m[1] * m[15] -
    m[8] * m[3] * m[13] -
    m[12] * m[1] * m[11] +
    m[12] * m[3] * m[9];
  inv[13] =
    m[0] * m[9] * m[14] -
    m[0] * m[10] * m[13] -
    m[8] * m[1] * m[14] +
    m[8] * m[2] * m[13] +
    m[12] * m[1] * m[10] -
    m[12] * m[2] * m[9];
  inv[2] =
    m[1] * m[6] * m[15] -
    m[1] * m[7] * m[14] -
    m[5] * m[2] * m[15] +
    m[5] * m[3] * m[14] +
    m[13] * m[2] * m[7] -
    m[13] * m[3] * m[6];
  inv[6] =
    -m[0] * m[6] * m[15] +
    m[0] * m[7] * m[14] +
    m[4] * m[2] * m[15] -
    m[4] * m[3] * m[14] -
    m[12] * m[2] * m[7] +
    m[12] * m[3] * m[6];
  inv[10] =
    m[0] * m[5] * m[15] -
    m[0] * m[7] * m[13] -
    m[4] * m[1] * m[15] +
    m[4] * m[3] * m[13] +
    m[12] * m[1] * m[7] -
    m[12] * m[3] * m[5];
  inv[14] =
    -m[0] * m[5] * m[14] +
    m[0] * m[6] * m[13] +
    m[4] * m[1] * m[14] -
    m[4] * m[2] * m[13] -
    m[12] * m[1] * m[6] +
    m[12] * m[2] * m[5];
  inv[3] =
    -m[1] * m[6] * m[11] +
    m[1] * m[7] * m[10] +
    m[5] * m[2] * m[11] -
    m[5] * m[3] * m[10] -
    m[9] * m[2] * m[7] +
    m[9] * m[3] * m[6];
  inv[7] =
    m[0] * m[6] * m[11] -
    m[0] * m[7] * m[10] -
    m[4] * m[2] * m[11] +
    m[4] * m[3] * m[10] +
    m[8] * m[2] * m[7] -
    m[8] * m[3] * m[6];
  inv[11] =
    -m[0] * m[5] * m[11] +
    m[0] * m[7] * m[9] +
    m[4] * m[1] * m[11] -
    m[4] * m[3] * m[9] -
    m[8] * m[1] * m[7] +
    m[8] * m[3] * m[5];
  inv[15] =
    m[0] * m[5] * m[10] -
    m[0] * m[6] * m[9] -
    m[4] * m[1] * m[10] +
    m[4] * m[2] * m[9] +
    m[8] * m[1] * m[6] -
    m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (Math.abs(det) < 1e-30) {
    return null;
  }
  for (let i = 0; i < 16; i++) {
    inv[i] /= det;
  }
  return inv;
}

export class Renderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private cull1Pipeline!: GPUComputePipeline; // MDI emit
  private cull2Pipeline!: GPUComputePipeline;
  private cullVp1Pipeline!: GPUComputePipeline; // vertex-pull emit
  private cullVp2Pipeline!: GPUComputePipeline;
  private hzbDownPipeline!: GPUComputePipeline;
  private hzbFirstPipeline!: GPUComputePipeline;
  private hzbFirstMsPipeline!: GPUComputePipeline;
  private renderPipeline1x!: GPURenderPipeline;
  private pickPipeline!: GPURenderPipeline; // id-only pick pass (opacity rule)
  private pickVpPipeline!: GPURenderPipeline;
  // outline effect: subset depth mask (MDI + VP) + fullscreen resolve chain
  private readonly outline = new OutlinePass();
  private renderPipeline4x!: GPURenderPipeline;
  private renderVpPipeline1x!: GPURenderPipeline;
  private renderVpPipeline4x!: GPURenderPipeline;
  private renderBlend1x!: GPURenderPipeline;
  private renderBlend4x!: GPURenderPipeline;
  private renderVpBlend1x!: GPURenderPipeline;
  private renderVpBlend4x!: GPURenderPipeline;
  private linePipeline1x!: GPURenderPipeline;
  private linePipeline4x!: GPURenderPipeline;
  private lineBind!: GPUBindGroup;
  // canvas-drawn view cube overlay (visuals only — the DOM ViewGizmo keeps
  // hit-testing; drawn after post AND into pending snapshots)
  private readonly viewCube = new ViewCubePass();
  private lineBuf: GPUBuffer | null = null;
  private lineCount = 0;
  private lastLineKey = '';
  private clipBuf!: GPUBuffer;
  private transformsBuf!: GPUBuffer;
  private lastClipKey = '';
  private clipVersion = 0;
  private vpGeoBGL!: GPUBindGroupLayout;
  private postPipeline!: GPURenderPipeline;
  private postMsPipeline!: GPURenderPipeline;
  private renderBGL!: GPUBindGroupLayout;
  private frameBuf!: GPUBuffer;
  private paramsBuf!: GPUBuffer;
  private postParamsBuf!: GPUBuffer;
  private countsBuf!: GPUBuffer;
  private cull1ParamsBind!: GPUBindGroup;
  private cullVp1ParamsBind!: GPUBindGroup;
  private cullVp2ParamsBind: GPUBindGroup | null = null;
  private models: GpuModel[] = [];
  multiDraw = false;
  adapterInfo = '';
  /** Adapter request preference — set BEFORE init() (Settings → Rendering → GPU). */
  gpuPreference: 'high-performance' | 'low-power' | 'fallback' = 'high-performance';
  cullMode: 'mdi' | 'vp' | 'full' = 'full'; // resolved per frame (for the HUD)
  gpuError = ''; // first uncaptured device error, shown in the HUD

  // GPU memory we allocated (WebGPU has no real VRAM query — this tracks our
  // own createBuffer/createTexture, decremented on destroy())
  vramBuffers = 0;
  vramTextures = 0;

  /** Effective device pixel ratio (options.pixelRatio, or the real one when null). */
  private get dpr(): number {
    return this.options.pixelRatio ?? window.devicePixelRatio;
  }

  // UI-driven options (read every frame)
  options = {
    // render scale: canvas pixels per CSS px; null = follow window.devicePixelRatio
    pixelRatio: 1 as number | null,
    meshletVis: false, // per-meshlet debug colors
    pxCut: 0, // while moving, cull meshlets with projected radius < this many px (0 = off)
    // pick rule (native mesh_pick): items at/above this opacity %% are clickable
    // and block clicks; below it clicks pass through. Shift inverts the band.
    pickOpacityPct: 10.1,
    protectDist: 0, // never px-cut geometry closer than this (world units)
    fastAA: false, // accumulation TAA (native taa.slang scheme): jitter + running average
    msaa4x: false,
    geoEdges: false, // depth + normal discontinuity edges (native edge.slang port)
    itemEdges: false, // id-boundary edges
    sketch: false, // technical-drawing mode: white background, black edge lines only
    edgeColor: [0, 0, 0] satisfies [number, number, number],
    fadeExp: 0.3,
    depthThr: 0.01,
    normalThr: 0.25,
    // separate edge tuning for meshes with authored normals (smooth shading)
    smoothFadeExp: 0.3,
    smoothDepthThr: 0.01,
    smoothNormalThr: 0.25,
    flatMeshEdges: true, // edge lines on flat-shaded meshes
    smoothMeshEdges: true, // edge lines on meshes with authored normals
    sketchRespectsEdgesOff: false, // sketch honors the edge-off switches
    // sketch colour-from-mesh: 'fill' washes coloured surfaces onto the paper,
    // 'edges' draws the ink in the mesh colour; colourless meshes always stay
    // plain paper + ink
    sketchColorMode: 'off' as 'off' | 'fill' | 'edges',
    whiteOnDark: true, // white edge color on items darker than darkThr (unlit luma)
    darkThr: 0.07,
    freezeCull: false, // keep last cull results, camera stays live
    debugBuf: 0, // 0 off, 1 normal, 2 depth, 3 item id, 4 raw edge, 5 ao
    aoMode: 0, // 0 off, 1 motion (every frame), 2 static (accumulate at rest)
    aoRadius: 0.8, // world-space sampling radius (m)
    aoStrength: 0.15,
    aoSlices: 6,
    aoSamples: 6,
    orthographic: false,
    vertexPull: false, // cull + draw via vertex pulling (core WebGPU, no MDI)
    bgColor: [0.557, 0.58, 0.624] satisfies [number, number, number], // #8e949f
    ambientColor: [1, 1, 1] satisfies [number, number, number],
    ambientIntensity: 0.45, // native LightingSettings defaults
    headlightColor: [1, 1, 1] satisfies [number, number, number],
    headlightIntensity: 0.65,
    selectionColor: [0.13, 0.2, 1.0] satisfies [number, number, number],
    transparencyBlend: false, // false = alpha hash (TAA), true = unsorted blend pass
    hasTransparency: false, // any opacity overrides exist (worker-reported)
    aaSamples: 32, // TAA/AO accumulation target (was a fixed 64)
    // true right after a color apply: overridden items show their color, not
    // the selection tint; any new selection turns it off again
    suppressTintOnOverride: false,
    gpuTimings: false, // per-pass GPU times via timestamp-query (Stats tab)
    // -----------------------------------------------------------------------------
    // outline effect (three.js OutlinePass port on the native hover_xray mask)
    // -----------------------------------------------------------------------------
    outlineHover: false, // outline the item under the cursor (viewport feeds hover picks)
    outlineSelection: false, // outline selected items
    selectionTint: true, // false = selection shows as outline only, no color tint
    outlineStrength: 3, // edge intensity multiplier (three.js edgeStrength)
    outlineGlow: 0, // 0-1: adds the half-res wide blur (three.js edgeGlow)
    outlineThickness: 1, // blur radius 1-4 px (three.js edgeThickness)
    outlinePulse: 0, // pulse period in seconds, 0 = off (three.js pulsePeriod)
    outlineVisibleColor: [1, 1, 1] satisfies [number, number, number],
    outlineHiddenColor: [0.098, 0.039, 0.02] satisfies [number, number, number], // #190a05
    outlineSelectionActive: false, // viewport hint: any items currently selected
  };
  private nextItemBase = 1; // 0 = background in the id buffer
  /** bumped on item-state uploads so the idle check re-renders */
  private stateVersion = 0;
  private wasMoving = false;
  /** performance.now() of the last frame whose viewport key changed (camera /
   *  resize / model count) — residency idle gate; `idle` alone is false during
   *  TAA accumulation so it cannot serve as "camera at rest". */
  lastMoveT = 0;

  // TAA accumulation: 0 = reset frame, grows while the camera is still.
  private accumIdx = 0;
  accumCount = 0; // for the HUD
  get aaMax(): number {
    return Math.max(1, Math.min(256, this.options.aaSamples));
  }

  // VBAO temporal accumulation (independent of TAA: AO can run without it)
  private aoAccum = 0;
  private aoRanLastFrame = false;
  private vbaoPipeline!: GPUComputePipeline;
  private vbaoMsPipeline!: GPUComputePipeline;
  // measurement snap compute (port of the native measure_snap.slang)
  private snapBGL!: GPUBindGroupLayout;
  private snapMinPipeline!: GPUComputePipeline;
  private snapWritePipeline!: GPUComputePipeline;
  private snapResultBuf!: GPUBuffer;
  private snapStagingBuf!: GPUBuffer;
  private snapParamsBuf!: GPUBuffer;
  private snapInFlight = false;
  private aoParamsBuf!: GPUBuffer;
  private aoTex: GPUTexture | null = null;
  private aoHist: GPUTexture | null = null;
  private aoBind: GPUBindGroup | null = null;

  // Render targets — rebuilt on resize or MSAA toggle.
  private depth: GPUTexture | null = null;
  private sceneColor: GPUTexture | null = null; // post-pass input
  private msColor: GPUTexture | null = null; // 4x target, resolves into sceneColor
  private normalTex: GPUTexture | null = null; // G-buffer (non-MSAA only)
  private idTex: GPUTexture | null = null;
  private histA: GPUTexture | null = null; // TAA accumulation sums (RGBA16F ping-pong)
  private histB: GPUTexture | null = null;
  private postBindEven: GPUBindGroup | null = null; // reads histA (writes histB)
  private postBindOdd: GPUBindGroup | null = null; // reads histB (writes histA)
  private targetsMsaa = false;
  private targetsPost = false;
  private targetsAo = false;

  // HZB pyramid
  private hzb: GPUTexture | null = null;
  private hzbMipCount = 0;
  private hzbBinds: GPUBindGroup[] = [];
  private hzbMipSizes: [number, number][] = [];
  private cull2ParamsBind: GPUBindGroup | null = null;

  // alt-click / Space pick. Reads the HZB mip 0 (always copyable) in MDI mode,
  // the raw depth buffer otherwise (only possible without MSAA — multisampled
  // depth cannot be copied to a buffer).
  private pickBuf: GPUBuffer | null = null;
  private pendingPick: PendingPick | null = null;
  private pickInFlight = false;
  private lastVP = new Float32Array(16);
  /** world position of the last successful click pick (native last_click_world) */
  lastClickWorld: [number, number, number] | null = null;

  /** Current view-projection matrix (column-major, as rendered last frame). */
  get viewProjMatrix(): Float32Array {
    return this.lastVP;
  }

  /** The init() canvas, guarded — these paths only run after init(). */
  private get hostCanvas(): HTMLCanvasElement {
    if (!this.canvasEl) {
      throw new Error('renderer not initialized');
    }
    return this.canvasEl;
  }

  /** World-space ray through a canvas CSS pixel (for gizmo interaction). */
  screenRay(cssX: number, cssY: number): { origin: [number, number, number]; dir: [number, number, number] } | null {
    const canvas = this.hostCanvas;
    const inv = invert4(this.lastVP);
    if (!inv) {
      return null;
    }
    const ndcX = ((cssX * this.dpr + 0.5) / canvas.width) * 2 - 1;
    const ndcY = 1 - ((cssY * this.dpr + 0.5) / canvas.height) * 2;
    const un = (d: number): [number, number, number] => {
      const c = [ndcX, ndcY, d, 1];
      const w = [0, 0, 0, 0];
      for (let r = 0; r < 4; r++) {
        w[r] = inv[r] * c[0] + inv[4 + r] * c[1] + inv[8 + r] * c[2] + inv[12 + r] * c[3];
      }
      return [w[0] / w[3], w[1] / w[3], w[2] / w[3]];
    };
    // reversed-Z: depth 1 = near, small depth = far
    const a = un(1);
    const b = un(0.001);
    const dir: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...dir) || 1;
    return { origin: a, dir: [dir[0] / l, dir[1] / l, dir[2] / l] };
  }

  /** Record the world position under a canvas pixel without moving the camera. */
  probeWorld(cssX: number, cssY: number) {
    this.queuePick(cssX, cssY, 'probe');
  }

  // one-shot promise variant: resolves with the clicked world point (null on
  // background) — used by "move selection to click" and similar tools
  private probeResolve: ((p: [number, number, number] | null) => void) | null = null;
  probeWorldAsync(cssX: number, cssY: number): Promise<[number, number, number] | null> {
    return new Promise((resolve) => {
      this.probeResolve?.(null);
      this.probeResolve = resolve;
      this.queuePick(cssX, cssY, 'probe');
    });
  }

  // Measurement hover probe: reads a small depth window around the cursor,
  // unprojects it, computes a geometric normal, and classifies face/edge/corner
  // from depth discontinuities (the native's screen-space baseline; precise
  // per-vertex snap would need a GPU mesh raycast). One in flight at a time.
  private measureResolve: ((p: MeasureProbe | null) => void) | null = null;
  private measureSnap: MeasureSnap = { enabled: true, corner: true, edge: true, cornerPx: 12, edgePx: 8 };
  probeMeasureAsync(cssX: number, cssY: number, snap: MeasureSnap): Promise<MeasureProbe | null> {
    return new Promise((resolve) => {
      this.measureResolve?.(null);
      this.measureResolve = resolve;
      this.measureSnap = snap;
      this.queuePick(cssX, cssY, 'measure');
    });
  }

  private queuePick(cssX: number, cssY: number, mode: PendingPick['mode']) {
    const canvas = this.hostCanvas;
    this.pendingPick = {
      x: Math.min(canvas.width - 1, Math.max(0, Math.floor(cssX * this.dpr))),
      y: Math.min(canvas.height - 1, Math.max(0, Math.floor(cssY * this.dpr))),
      mode,
    };
  }

  // one-shot frame capture: resolves with RGBA pixels of the CONVERGED frame.
  // A pending snapshot blocks the idle skip, so the renderer keeps rendering
  // until TAA/AO have fully accumulated — only then is the presented swapchain
  // (post output: edges, AA, AO, view cube) copied. What you see is what you get.
  private pendingSnap: ((img: { w: number; h: number; rgba: Uint8ClampedArray }) => void) | null = null;
  snapshot(): Promise<{ w: number; h: number; rgba: Uint8ClampedArray }> {
    return new Promise((res) => (this.pendingSnap = res));
  }

  // Extra render-resolution multiplier for a hi-res snapshot, applied ON TOP of
  // dpr in frame(). Kept OUT of `options` on purpose — viewport.ts's per-frame
  // applyOptions() rewrites options.pixelRatio every frame and would clobber it.
  private captureScale = 1;

  /** Higher-resolution snapshot: temporarily raise the render scale so the long
   *  edge reaches ~`targetLongEdge` px (4K by default, capped to the GPU's max
   *  texture size), let TAA/AO reconverge at that size, capture, then restore.
   *  This drives the SAME pixel-tuned post pipeline (edges, AA, AO) as a retina
   *  render — just more pixels — so the result stays anti-aliased. Never
   *  downscales below the current render resolution. The continuous rAF loop
   *  resizes to the new scale next frame and back once it's restored. */
  async snapshotHiRes(targetLongEdge = 3840): Promise<{ w: number; h: number; rgba: Uint8ClampedArray }> {
    const canvas = this.hostCanvas;
    const longCss = Math.max(canvas.clientWidth, canvas.clientHeight) || 1;
    const target = Math.min(targetLongEdge, this.device.limits.maxTextureDimension2D);
    const base = longCss * this.dpr; // current render px on the long edge
    this.captureScale = Math.max(1, target / base);
    try {
      return await this.snapshot();
    } finally {
      this.captureScale = 1;
    }
  }

  // click item-picking from the id G-buffer (rgba8unorm -> packed global id)
  private readonly itemPick = new ItemPickPass();

  /** Read the item id under a canvas pixel (CSS px). Resolves null on background. */
  pickItem(cssX: number, cssY: number, shift = false): Promise<number | null> {
    return this.itemPick.request(Math.floor(cssX * this.dpr), Math.floor(cssY * this.dpr), shift);
  }

  // -----------------------------------------------------------------------------
  // outline effect state (viewport feeds hover ids from throttled picks)
  // -----------------------------------------------------------------------------
  private hoverItemId = 0; // global item id under the cursor, 0 = none
  private drawnHoverId = 0; // hover id the last encoded frame outlined
  /** Set the hover-outlined item (global id; null/0 = none). Cheap to call —
   *  a change only breaks the idle skip, converged frames use the hold path. */
  setHoverItem(id: number | null) {
    this.hoverItemId = id ?? 0;
  }
  // First-load flag: the default top/front-right view is applied once.
  private hadFirstFit = false;

  // idle skip: re-render only when something changed
  private lastKey = '';
  private lastVpKey = '';
  idle = false;

  // periodic draw-count readback for the HUD
  private statsBuf!: GPUBuffer;
  private statsInFlight = false;
  private lastCountRead = 0;
  /** Per-slot drawn-meshlet counts from the last readback (~2 Hz) — 0 means
   *  the model was frustum-culled or fully HiZ-occluded that frame (the
   *  residency manager treats such zones as "not seen"). */
  drawnPerModel: Uint32Array = new Uint32Array(0);
  drawnPass1 = 0;
  drawnPass2 = 0;

  // GPU pass timings (timestamp-query, enabled from the Stats tab)
  private readonly timings = new GpuTimings();

  get gpuTimingSupported(): boolean {
    return this.timings.supported;
  }

  /** smoothed per-pass ms from the last resolved frame, insertion-ordered */
  get gpuTimes(): { label: string; ms: number }[] {
    return this.timings.times;
  }

  // perf stats
  private frames = 0;
  private lastStat = performance.now();
  private lastFrame = performance.now();
  fps = 0;
  cpuMs = 0;

  readonly camera = new CameraController();
  private sceneMin = [Infinity, Infinity, Infinity];
  private sceneMax = [-Infinity, -Infinity, -Infinity];
  private denseMin = [Infinity, Infinity, Infinity];
  private denseMax = [-Infinity, -Infinity, -Infinity];
  /** Frame the v8 percentile dense bounds instead of the full AABB (setting). */
  fitDense = true;

  get sceneBounds(): { min: number[]; max: number[] } {
    return { min: this.sceneMin, max: this.sceneMax };
  }

  /** The box the camera should frame: dense union when enabled + available. */
  get fitTarget(): { min: number[]; max: number[] } {
    if (this.fitDense && Number.isFinite(this.denseMin[0])) {
      return { min: this.denseMin, max: this.denseMax };
    }
    return { min: this.sceneMin, max: this.sceneMax };
  }

  /** Fit the camera to an arbitrary box (assets batch-load fit). */
  fitBounds(min: number[], max: number[]) {
    this.camera.fit(min, max);
  }

  /** A caller has placed the camera deliberately (postMessage `camera.set`, or
   *  a `camera` on a load): the first-model default view must NOT override
   *  it — that reset also cancels an in-flight move. Later loads never touch
   *  the camera here anyway; the assets loader decides. */
  markViewChosen() {
    this.hadFirstFit = true;
  }

  /** Upload the clip uniform (260 floats, ClipData layout) when it changed.
   * The last data is kept CPU-side for the residency manager's clip test. */
  setClip(data: Float32Array) {
    const key = data.join(',');
    if (key === this.lastClipKey) {
      return;
    }
    this.lastClipKey = key;
    this.clipData = data;
    this.clipDataU32 = new Uint32Array(data.buffer, data.byteOffset, data.length);
    this.device.queue.writeBuffer(this.clipBuf, 0, data);
    this.clipVersion++;
  }

  /** Last uploaded ClipData floats (null before the first setClip). */
  clipData: Float32Array | null = null;
  clipDataU32: Uint32Array | null = null;

  /** Helper line list: [x, y, z, colorBits(f32-bitcast)] per vertex, pairs. */
  setHelperLines(verts: Float32Array) {
    const key = verts.join(',');
    if (key === this.lastLineKey) {
      return;
    }
    this.lastLineKey = key;
    this.lineCount = verts.length / 4;
    if (this.lineCount === 0) {
      this.clipVersion++;
      return;
    }
    if (!this.lineBuf || this.lineBuf.size < verts.byteLength) {
      this.lineBuf?.destroy();
      this.lineBuf = this.device.createBuffer({
        label: 'lineBuf',
        size: Math.max(256, verts.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.lineBuf, 0, verts);
    this.clipVersion++;
  }

  /** The canvas init() was called with — screenshot composition needs its host. */
  canvasEl: HTMLCanvasElement | null = null;

  async init(canvas: HTMLCanvasElement) {
    this.canvasEl = canvas;
    if (!navigator.gpu) {
      throw new Error('WebGPU not available in this browser');
    }
    let adapter = await navigator.gpu.requestAdapter({
      powerPreference: this.gpuPreference === 'fallback' ? undefined : this.gpuPreference,
      forceFallbackAdapter: this.gpuPreference === 'fallback',
    });
    // the preference is only a hint — if it resolves to nothing, take any adapter
    adapter ??= await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('no WebGPU adapter');
    }

    const info = adapter.info;
    this.adapterInfo = `${info.vendor} ${info.architecture} ${info.device} ${info.description}`.trim();

    const wanted: string[] = [];
    if (adapter.features.has('chromium-experimental-multi-draw-indirect')) {
      wanted.push('chromium-experimental-multi-draw-indirect');
      this.multiDraw = true;
    }
    const hasTimestamps = adapter.features.has('timestamp-query');
    if (hasTimestamps) {
      wanted.push('timestamp-query');
    }
    this.device = await adapter.requestDevice({
      requiredFeatures: wanted as GPUFeatureName[],
      requiredLimits: {
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, 2147483648),
        maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 2147483648),
        // the vertex-pull path binds 9 vertex-stage storage buffers since the
        // authored-normal stream landed (default limit is 8) — clamped to the
        // adapter's own max so the request itself can never fail
        maxStorageBuffersPerShaderStage: Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 16),
      },
    });

    this.timings.attach(this.device, hasTimestamps);
    trackDeviceAllocations(
      this.device,
      (delta) => {
        this.vramBuffers += delta;
      },
      (delta) => {
        this.vramTextures += delta;
      },
    );

    this.device.lost.then((info) => {
      // "destroyed" is the expected result of dispose() (e.g. React StrictMode
      // double-mount tearing down the first instance) — not an error.
      if (info.reason === 'destroyed') {
        return;
      }
      this.gpuError = `device lost: ${info.reason} ${info.message}`;
      console.error('WebGPU device lost:', info.reason, info.message);
    });
    this.device.addEventListener('uncapturederror', (e) => {
      const msg = (e as GPUUncapturedErrorEvent).error.message;
      if (!this.gpuError) {
        this.gpuError = msg;
      }
      console.error('WebGPU:', msg);
    });

    this.context = canvas.getContext('webgpu')!;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const dev = this.device;
    this.frameBuf = dev.createBuffer({
      label: 'frameBuf',
      // four Frame slots (opaque @0, blend pass @256, pick pass @512,
      // outline mask @768) selected per draw via a dynamic offset on binding 0
      size: 1024,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.paramsBuf = dev.createBuffer({
      label: 'paramsBuf',
      size: PARAMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.postParamsBuf = dev.createBuffer({
      label: 'postParamsBuf',
      size: 80, // PostParams in shaders.ts (incl. smooth-mesh edge tuning)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.clipBuf = dev.createBuffer({
      label: 'clipBuf',
      size: 1040, // ClipData in shaders.ts (planes + mask + 8 tagged-union shapes; slot 0 = default box)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // committed item-transform pool (mat4 slots, worker TRANSFORM_POOL);
    // slot 0 = identity, shared by every model's render + cull bind groups
    this.transformsBuf = dev.createBuffer({
      label: 'transformsBuf',
      size: 4096 * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(this.transformsBuf, 0, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    this.countsBuf = dev.createBuffer({
      label: 'countsBuf',
      size: MAX_MODELS * COUNT_SLOT * 2,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.statsBuf = dev.createBuffer({
      label: 'statsBuf',
      size: MAX_MODELS * COUNT_SLOT * 2,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const compute = (code: string) =>
      dev.createComputePipeline({
        label: 'computePipeline',
        layout: 'auto',
        compute: { module: dev.createShaderModule({ label: 'computeModule', code }), entryPoint: 'main' },
      });
    this.cull1Pipeline = compute(cullWgsl(false, false));
    this.cull2Pipeline = compute(cullWgsl(true, false));
    this.cullVp1Pipeline = compute(cullWgsl(false, true));
    this.cullVp2Pipeline = compute(cullWgsl(true, true));
    this.hzbDownPipeline = compute(hzbWgsl(false));
    this.hzbFirstPipeline = this.hzbDownPipeline; // non-MS depth binds as texture_2d<f32>
    this.hzbFirstMsPipeline = compute(hzbWgsl(true));
    this.vbaoPipeline = compute(vbaoWgsl(false));
    this.vbaoMsPipeline = compute(vbaoWgsl(true));
    // measurement snap (native measure_snap.slang port): one module, two passes
    // sharing an explicit layout so both bind the same per-model group
    const snapModule = dev.createShaderModule({ label: 'snapModule', code: measureSnapWgsl() });
    const sbuf = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    });
    this.snapBGL = dev.createBindGroupLayout({
      entries: [
        sbuf(0, 'storage'),
        sbuf(1, 'read-only-storage'),
        sbuf(2, 'read-only-storage'),
        sbuf(3, 'read-only-storage'),
        sbuf(4, 'read-only-storage'),
        sbuf(5, 'read-only-storage'),
        sbuf(6, 'read-only-storage'),
        sbuf(7, 'uniform'),
      ],
    });
    const snapLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.snapBGL] });
    this.snapMinPipeline = dev.createComputePipeline({
      label: 'snapMinPipeline',
      layout: snapLayout,
      compute: { module: snapModule, entryPoint: 'snapMin' },
    });
    this.snapWritePipeline = dev.createComputePipeline({
      label: 'snapWritePipeline',
      layout: snapLayout,
      compute: { module: snapModule, entryPoint: 'snapWrite' },
    });
    this.snapResultBuf = dev.createBuffer({
      label: 'snapResultBuf',
      size: 64, // 16 u32 words (t, valid, u, v, A, B, C)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.snapStagingBuf = dev.createBuffer({
      label: 'snapStagingBuf',
      size: 64,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.snapParamsBuf = dev.createBuffer({
      label: 'snapParamsBuf',
      size: 32, // SnapParams: ray_origin + ray_dir
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.aoParamsBuf = dev.createBuffer({
      label: 'aoParamsBuf',
      size: 64, // AoParams in shaders.ts
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.cull1ParamsBind = dev.createBindGroup({
      label: 'cull1ParamsBind',
      layout: this.cull1Pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 3, resource: { buffer: this.clipBuf } },
      ],
    });
    this.cullVp1ParamsBind = dev.createBindGroup({
      label: 'cullVp1ParamsBind',
      layout: this.cullVp1Pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 3, resource: { buffer: this.clipBuf } },
      ],
    });

    // Explicit layout so one per-model bind group serves both sample counts.
    this.renderBGL = dev.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FRAME_SIZE },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 3, // item states: [flags, color] per dense item (FS: outline mask)
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 4, // per-model uniform: {item_base} (FS: outline mask)
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 5, // clip planes + box
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 6, // committed item transforms (global pool)
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 7, // optional authored normals (oct u32/vertex; dummy when absent)
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    const renderLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.renderBGL] });
    // Both sample counts render the full G-buffer (normal + packed item id).
    // Positions stay quantized u16, dequantized per meshlet in the VS.
    const renderModule = dev.createShaderModule({ label: 'renderModule', code: renderWgsl(true) });
    // blend variant: unsorted transparency pass — alpha blend on the color
    // target, G-buffer masked (transparent items don't get edges/ids, matching
    // native), depth-tested but not written
    const blendTargets = (blend: boolean): GPUColorTargetState[] => [
      blend
        ? {
            format: this.format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'zero' },
            },
          }
        : { format: this.format },
      { format: 'rgba8unorm', writeMask: blend ? 0 : 0xf },
      { format: 'rgba8unorm', writeMask: blend ? 0 : 0xf },
    ];
    const makeRender = (sampleCount: number, blend = false) =>
      dev.createRenderPipeline({
        label: 'renderPipeline',
        layout: renderLayout,
        vertex: {
          module: renderModule,
          entryPoint: 'vs',
          buffers: [
            {
              arrayStride: 8,
              attributes: [{ shaderLocation: 0, offset: 0, format: 'uint16x4' as const }],
            },
          ],
        },
        fragment: { module: renderModule, entryPoint: 'fs', targets: blendTargets(blend) },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
          format: 'depth32float',
          depthWriteEnabled: !blend,
          depthCompare: 'greater', // reversed-Z
        },
        multisample: { count: sampleCount },
      });
    this.renderPipeline1x = makeRender(1);
    this.renderPipeline4x = makeRender(4);
    this.renderBlend1x = makeRender(1, true);
    this.renderBlend4x = makeRender(4, true);
    // pick pass (native mesh_pick): ids only, opacity-threshold rule in fs_pick
    this.pickPipeline = dev.createRenderPipeline({
      label: 'pickPipeline',
      layout: renderLayout,
      vertex: {
        module: renderModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 8,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'uint16x4' as const }],
          },
        ],
      },
      fragment: { module: renderModule, entryPoint: 'fs_pick', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    });

    // vertex-pull path: geometry comes from storage buffers (group 1)
    this.vpGeoBGL = dev.createBindGroupLayout({
      entries: [0, 1, 2, 3].map((binding) => ({
        binding,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'read-only-storage' as const },
      })),
    });
    const vpLayout = dev.createPipelineLayout({
      bindGroupLayouts: [this.renderBGL, this.vpGeoBGL],
    });
    const vpModule = dev.createShaderModule({ label: 'vpModule', code: renderVpWgsl() });
    const makeRenderVp = (sampleCount: number, blend = false) =>
      dev.createRenderPipeline({
        label: 'renderVpPipeline',
        layout: vpLayout,
        vertex: { module: vpModule, entryPoint: 'vs' },
        fragment: { module: vpModule, entryPoint: 'fs', targets: blendTargets(blend) },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: {
          format: 'depth32float',
          depthWriteEnabled: !blend,
          depthCompare: 'greater',
        },
        multisample: { count: sampleCount },
      });
    this.renderVpPipeline1x = makeRenderVp(1);
    this.renderVpPipeline4x = makeRenderVp(4);
    this.renderVpBlend1x = makeRenderVp(1, true);
    this.renderVpBlend4x = makeRenderVp(4, true);
    this.pickVpPipeline = dev.createRenderPipeline({
      label: 'pickVpPipeline',
      layout: vpLayout,
      vertex: { module: vpModule, entryPoint: 'vs' },
      fragment: { module: vpModule, entryPoint: 'fs_pick', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    });

    // clip helper lines: drawn at the end of the last scene pass (same
    // attachments — G-buffer targets masked off), depth-tested, no writes
    const lineBGL = dev.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const lineModule = dev.createShaderModule({ label: 'lineModule', code: lineWgsl() });
    const makeLine = (sampleCount: number) =>
      dev.createRenderPipeline({
        label: 'linePipeline',
        layout: dev.createPipelineLayout({ bindGroupLayouts: [lineBGL] }),
        vertex: {
          module: lineModule,
          entryPoint: 'vs',
          buffers: [
            {
              arrayStride: 16,
              attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' as const }],
            },
          ],
        },
        fragment: {
          module: lineModule,
          entryPoint: 'fs',
          targets: [
            { format: this.format },
            { format: 'rgba8unorm', writeMask: 0 },
            { format: 'rgba8unorm', writeMask: 0 },
          ],
        },
        primitive: { topology: 'line-list' },
        depthStencil: {
          format: 'depth32float',
          depthWriteEnabled: false,
          depthCompare: 'greater',
        },
        multisample: { count: sampleCount },
      });
    this.linePipeline1x = makeLine(1);
    this.linePipeline4x = makeLine(4);
    this.lineBind = dev.createBindGroup({
      label: 'lineBind',
      layout: lineBGL,
      entries: [{ binding: 0, resource: { buffer: this.frameBuf } }],
    });

    this.viewCube.init(dev, this.format);

    const makePost = (msaa: boolean) => {
      const m = dev.createShaderModule({ label: 'postModule', code: postWgsl(msaa) });
      return dev.createRenderPipeline({
        label: 'postPipeline',
        layout: 'auto',
        vertex: { module: m, entryPoint: 'vs' },
        fragment: {
          module: m,
          entryPoint: 'fs',
          targets: [{ format: this.format }, { format: 'rgba16float' }],
        },
        primitive: { topology: 'triangle-list' },
      });
    };
    this.postPipeline = makePost(false);
    this.postMsPipeline = makePost(true);

    this.outline.init(dev, this.format, renderLayout, renderModule, vpLayout, vpModule);

    this.camera.attach(canvas, (x, y, goto) => {
      this.queuePick(x, y, goto ? 'fly' : 'pivot');
    });
  }

  /** Create the full per-model GPU resource set (13 buffers + 8 bind groups)
   * for the given packed geometry, bound to a caller-chosen itemBase and
   * counts-buffer slot. Shared by first upload and slot revive — revive passes
   * the tombstone's preserved itemBase/countOffsets so item ids and the
   * per-slot draw-count sub-allocation stay stable across variant swaps. */
  private buildModelResources(
    packed: GpuPackedModel,
    opts: { edges?: boolean },
    itemBase: number,
    countOffset1: number,
    countOffset2: number,
  ): GpuModel {
    const dev = this.device;
    const { positionsQ, indices16, cull, meshletInfo, cgColors } = packed;
    const totalMeshlets = packed.meshletCount;
    const triangleCount = packed.triangleCount;

    const mkBuf = (data: ArrayBufferView | ArrayBuffer, usage: number) => {
      const bytes = data instanceof ArrayBuffer ? data : (data.buffer as ArrayBuffer);
      const len = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
      const off = data instanceof ArrayBuffer ? 0 : data.byteOffset;
      const buf = dev.createBuffer({
        label: 'modelBuf',
        // floor 64 B: near-empty coarse variants (1-2 triangles) must still
        // satisfy every pipeline's minimum binding size (largest stride 48 B)
        size: Math.max(64, Math.ceil(len / 4) * 4),
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      dev.queue.writeBuffer(buf, 0, bytes, off, len);
      return buf;
    };

    // STORAGE lets the vertex-pull path read the same buffers the MDI path
    // consumes as vertex/index buffers. COPY_SRC lets the GLB export read the
    // geometry back — the packed arrays only exist on the GPU after upload.
    const vertexBuf = mkBuf(positionsQ, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const indexBuf = mkBuf(indices16, GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const cgColorBuf = mkBuf(cgColors, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const meshletCullBuf = mkBuf(cull, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    // visibility starts at 1: first frame's pass 1 draws everything in-frustum
    const visBuf = mkBuf(new Uint32Array(totalMeshlets).fill(1), GPUBufferUsage.STORAGE);

    const mkRecords = () =>
      dev.createBuffer({
        label: 'modelRecordBuf',
        size: Math.max(RECORD_STRIDE, totalMeshlets * RECORD_STRIDE),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
      });
    const recordBuf1 = mkRecords();
    const recordBuf2 = mkRecords();

    // args size differs: MDI binds a bare 4-byte atomic counter, the vertex-pull
    // emit binds the full 16-byte drawIndirect args block at the same offset.
    const mkCullBind = (pipeline: GPUComputePipeline, recordBuf: GPUBuffer, countOffset: number, argsSize: number) =>
      dev.createBindGroup({
        label: 'cullBind',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: meshletCullBuf } },
          { binding: 1, resource: { buffer: recordBuf } },
          { binding: 2, resource: { buffer: this.countsBuf, offset: countOffset, size: argsSize } },
          { binding: 3, resource: { buffer: visBuf } },
          { binding: 4, resource: { buffer: meshletInfoBuf } },
          { binding: 5, resource: { buffer: itemStateBuf } },
          { binding: 6, resource: { buffer: this.transformsBuf } },
          { binding: 7, resource: { buffer: modelUniBuf } },
        ],
      });

    const meshletInfoBuf = mkBuf(meshletInfo, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);

    // per-item [flags, colorRGBA8, transform_idx] (native 12-byte MeshItem);
    // zero = no selection, no override, identity transform
    const itemStateBuf = dev.createBuffer({
      label: 'itemStateBuf',
      size: Math.max(12, packed.itemCount * 12),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // ModelUni: info vec4u {item_base, live_active, 0, 0} + live mat4
    // (the live gizmo-drag group matrix; see setSelectionTransform)
    // ModelUni info.z = has authored normals (shader picks stream vs flat);
    // info.w = edge lines OFF for this model (asset import option)
    const modelUniInit = new ArrayBuffer(80);
    new Uint32Array(modelUniInit, 0, 4).set([itemBase, 0, packed.normalsQ ? 1 : 0, opts.edges === false ? 1 : 0]);
    new Float32Array(modelUniInit, 16, 16).set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const modelUniBuf = mkBuf(modelUniInit, GPUBufferUsage.UNIFORM);
    // authored normals (oct u32/vertex) — 1-word dummy keeps the layout bound
    const normalBuf = mkBuf(packed.normalsQ ?? new Uint32Array(1), GPUBufferUsage.STORAGE);

    const renderBind = dev.createBindGroup({
      label: 'renderBind',
      layout: this.renderBGL,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuf, size: FRAME_SIZE } },
        { binding: 1, resource: { buffer: cgColorBuf } },
        { binding: 2, resource: { buffer: meshletInfoBuf } },
        { binding: 3, resource: { buffer: itemStateBuf } },
        { binding: 4, resource: { buffer: modelUniBuf } },
        { binding: 5, resource: { buffer: this.clipBuf } },
        { binding: 6, resource: { buffer: this.transformsBuf } },
        { binding: 7, resource: { buffer: normalBuf } },
      ],
    });

    // static full-draw inputs for the no-cull fallback (all meshlets, one draw)
    const iota = new Uint32Array(totalMeshlets);
    for (let i = 0; i < totalMeshlets; i++) {
      iota[i] = i;
    }
    const fullListBuf = mkBuf(iota, GPUBufferUsage.STORAGE);
    const fullArgsBuf = mkBuf(new Uint32Array([372, totalMeshlets, 0, 0]), GPUBufferUsage.INDIRECT);

    const mkVpGeoBind = (listBuf: GPUBuffer) =>
      dev.createBindGroup({
        label: 'vpGeoBind',
        layout: this.vpGeoBGL,
        entries: [
          { binding: 0, resource: { buffer: listBuf } },
          { binding: 1, resource: { buffer: meshletCullBuf } },
          { binding: 2, resource: { buffer: indexBuf } },
          { binding: 3, resource: { buffer: vertexBuf } },
        ],
      });

    const buffers = [
      vertexBuf,
      indexBuf,
      cgColorBuf,
      meshletCullBuf,
      recordBuf1,
      recordBuf2,
      visBuf,
      meshletInfoBuf,
      itemStateBuf,
      normalBuf,
      modelUniBuf,
      fullListBuf,
      fullArgsBuf,
    ];

    return {
      name: packed.name,
      meshletCount: totalMeshlets,
      triangleCount,
      bytes: buffers.reduce((sum, b) => sum + b.size, 0),
      vertexBuf,
      indexBuf,
      cgColorBuf,
      meshletCullBuf,
      recordBuf1,
      recordBuf2,
      visBuf,
      meshletInfoBuf,
      itemStateBuf,
      normalBuf,
      modelUniBuf,
      itemBase,
      itemCount: packed.itemCount,
      cullBind1: mkCullBind(this.cull1Pipeline, recordBuf1, countOffset1, 4),
      cullBind2: mkCullBind(this.cull2Pipeline, recordBuf2, countOffset2, 4),
      cullVpBind1: mkCullBind(this.cullVp1Pipeline, recordBuf1, countOffset1, 16),
      cullVpBind2: mkCullBind(this.cullVp2Pipeline, recordBuf2, countOffset2, 16),
      renderBind,
      vpGeoBind1: mkVpGeoBind(recordBuf1),
      vpGeoBind2: mkVpGeoBind(recordBuf2),
      vpGeoBindFull: mkVpGeoBind(fullListBuf),
      fullListBuf,
      fullArgsBuf,
      countOffset1,
      countOffset2,
    };
  }

  /** Upload a new model into a fresh slot. Returns the slot index. */
  uploadModel(packed: GpuPackedModel, opts: { edges?: boolean } = {}): number {
    if (this.models.length >= MAX_MODELS) {
      throw new Error('model limit reached');
    }
    const modelIdx = this.models.length;
    const countOffset1 = modelIdx * COUNT_SLOT * 2;
    const countOffset2 = countOffset1 + COUNT_SLOT;
    const itemBase = this.nextItemBase;
    this.nextItemBase += packed.itemCount;
    this.models.push(this.buildModelResources(packed, opts, itemBase, countOffset1, countOffset2));

    for (let i = 0; i < 3; i++) {
      this.sceneMin[i] = Math.min(this.sceneMin[i], packed.boundsMin[i]);
      this.sceneMax[i] = Math.max(this.sceneMax[i], packed.boundsMax[i]);
      this.denseMin[i] = Math.min(this.denseMin[i], (packed.denseMin ?? packed.boundsMin)[i]);
      this.denseMax[i] = Math.max(this.denseMax[i], (packed.denseMax ?? packed.boundsMax)[i]);
    }

    // First load ONLY: default view from the top, halfway between FRONT
    // (az π/2) and RIGHT (az π), framing the dense bounds when enabled.
    // Later loads never move the camera here — the assets loader decides
    // (fit-to-batch unless "Keep camera" is on).
    if (!this.hadFirstFit) {
      this.hadFirstFit = true;
      this.camera.setView((3 * Math.PI) / 4, -0.61); // ~35° down
      const t = this.fitTarget;
      this.camera.fit(t.min, t.max);
    }
    return modelIdx;
  }

  /** Rebuild a tombstoned slot in place with fresh packed geometry (variant
   * swap / reload). Preserves the slot's itemBase and counts-buffer offsets so
   * global item ids, selections, and worker indices stay valid. Throws WITHOUT
   * allocating anything if the slot is live or the item count differs — the
   * caller falls back to a fresh uploadModel in that case. Scene bounds are
   * not re-unioned (they were on first upload and never shrink). */
  reviveModel(slot: number, packed: GpuPackedModel, opts: { edges?: boolean } = {}): void {
    const m = this.models[slot];
    if (!m?.dead) {
      throw new Error(`reviveModel: slot ${slot} is not a tombstone`);
    }
    if (packed.itemCount !== m.itemCount) {
      throw new Error(`itemcount-mismatch: slot ${slot} has ${m.itemCount}, packed has ${packed.itemCount}`);
    }
    this.models[slot] = this.buildModelResources(packed, opts, m.itemBase, m.countOffset1, m.countOffset2);
    this.lastKey = ''; // force a re-render with the new geometry
    this.stateVersion++;
  }

  /** GPU bytes held by one model slot (0 for tombstones). */
  modelBytes(slot: number): number {
    const m = this.models[slot];
    return !m || m.dead ? 0 : m.bytes;
  }

  /** Resident meshlets in one model slot (0 for tombstones AND for packs that
   * ended up empty — such a slot can never report draws). */
  modelMeshletCount(slot: number): number {
    const m = this.models[slot];
    return !m || m.dead ? 0 : m.meshletCount;
  }

  get stats() {
    let meshlets = 0,
      tris = 0;
    for (const m of this.models) {
      if (m.dead) {
        continue;
      }
      meshlets += m.meshletCount;
      tris += m.triangleCount;
    }
    return { models: this.models.filter((m) => !m.dead).length, meshlets, tris };
  }

  /** Tear down the GPU device (panel unmount). The instance is dead after this. */
  dispose() {
    this.device?.destroy();
  }

  /** Upload fresh per-item state for one model (from the worker). Dead slots
   * are skipped — state producers keep emitting for unloaded-but-live DbModels. */
  writeItemStates(model: number, states: Uint32Array) {
    const m = this.models[model];
    if (!m || m.dead) {
      return;
    }
    this.device.queue.writeBuffer(m.itemStateBuf, 0, states, 0, Math.min(states.length, m.itemCount * 3));
    this.stateVersion++; // re-render even when idle
  }

  /** Live selection transform (gizmo drag preview): one UBO write per model,
   * the shaders apply it to SELECTED items only. null = drag ended. */
  setSelectionTransform(matrix: Float32Array | null) {
    for (const m of this.models) {
      if (m.dead) {
        continue;
      }
      this.device.queue.writeBuffer(m.modelUniBuf, 4, new Uint32Array([matrix ? 1 : 0]));
      if (matrix) {
        this.device.queue.writeBuffer(m.modelUniBuf, 16, matrix, 0, 16);
      }
    }
    this.stateVersion++;
  }

  /** Upload the used region of the worker's transform pool (mat4 slots). */
  writeTransforms(pool: Float32Array) {
    this.device.queue.writeBuffer(this.transformsBuf, 0, pool, 0, Math.min(pool.length, 4096 * 16));
    this.stateVersion++;
  }

  /** Live (non-tombstoned) models for export UIs — indices align with the worker. */
  liveModels(): { index: number; name: string }[] {
    return this.models.map((m, index) => ({ index, name: m.name, dead: m.dead })).filter((m) => !m.dead);
  }

  /** Read a model's packed geometry back from the GPU (GLB export) — the
   *  arrays were transferred to VRAM at upload and exist nowhere else.
   *  Layouts are the pack.ts ones (positionsQ u16x4, cull 36 B packed records
   *  with the draw template, meshletInfo 8 words, cgColors f32x4). */
  async readModelGeometry(index: number): Promise<{
    name: string;
    meshletCount: number;
    positionsQ: ArrayBuffer;
    indices16: ArrayBuffer;
    cull: ArrayBuffer;
    meshletInfo: ArrayBuffer;
    cgColors: ArrayBuffer;
  } | null> {
    const m = this.models[index];
    if (!m || m.dead) {
      return null;
    }
    const dev = this.device;
    const sources = [m.vertexBuf, m.indexBuf, m.meshletCullBuf, m.meshletInfoBuf, m.cgColorBuf];
    const staging = sources.map((src) =>
      dev.createBuffer({
        label: 'modelReadbackStaging',
        size: src.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
    );
    const enc = dev.createCommandEncoder();
    sources.forEach((src, i) => {
      enc.copyBufferToBuffer(src, 0, staging[i], 0, src.size);
    });
    dev.queue.submit([enc.finish()]);
    await Promise.all(staging.map((b) => b.mapAsync(GPUMapMode.READ)));
    const [positionsQ, indices16, cull, meshletInfo, cgColors] = staging.map((b) => {
      const copy = b.getMappedRange().slice(0);
      b.unmap();
      b.destroy();
      return copy;
    });
    return { name: m.name, meshletCount: m.meshletCount, positionsQ, indices16, cull, meshletInfo, cgColors };
  }

  /** Debug: per-model meshlet fill statistics, read back from the GPU cull/info
   *  records. Geometry bytes are packed to content, but every meshlet pays
   *  MESHLET_RECORD_BYTES no matter how full it is — low fill shows up as the
   *  gap between the actual record count and the two repack bounds. */
  async readMeshletFill(): Promise<
    {
      name: string;
      meshlets: number;
      tris: number;
      /** Meshlet counts bucketed by fill: [1–15, 16–31, … 96–111, ≥112] tris. */
      hist: number[];
      /** Items owning at least one meshlet. */
      items: number;
      /** Records if every item packed its own meshlets full — the achievable
       *  bound (meshlets never span items in this pipeline). */
      idealPerItem: number;
      /** Records if meshlets could also span items — the hard floor. */
      idealCrossItem: number;
      /** Vertex + index + authored-normal buffer bytes (packed to content). */
      geoBytes: number;
      recordBytes: number;
    }[]
  > {
    const dev = this.device;
    const out = [];
    for (const m of this.models) {
      if (m.dead || m.meshletCount === 0) {
        continue;
      }
      const staging = [m.meshletCullBuf, m.meshletInfoBuf].map((src) =>
        dev.createBuffer({
          label: 'fillStatsStaging',
          size: src.size,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }),
      );
      const enc = dev.createCommandEncoder();
      enc.copyBufferToBuffer(m.meshletCullBuf, 0, staging[0], 0, m.meshletCullBuf.size);
      enc.copyBufferToBuffer(m.meshletInfoBuf, 0, staging[1], 0, m.meshletInfoBuf.size);
      dev.queue.submit([enc.finish()]);
      await Promise.all(staging.map((b) => b.mapAsync(GPUMapMode.READ)));
      const cullU = new Uint32Array(staging[0].getMappedRange());
      const infoU = new Uint32Array(staging[1].getMappedRange());
      const hist = new Array<number>(8).fill(0);
      const itemTris = new Uint32Array(m.itemCount);
      let tris = 0;
      for (let i = 0; i < m.meshletCount; i++) {
        const t = cullU[i * 9 + 5] / 3; // index_count word of the packed cull record
        tris += t;
        hist[Math.min(7, Math.floor(t / 16))]++;
        const item = infoU[i * 8 + 7];
        if (item < m.itemCount) {
          itemTris[item] += t;
        }
      }
      let items = 0;
      let idealPerItem = 0;
      for (let i = 0; i < m.itemCount; i++) {
        if (itemTris[i] === 0) {
          continue;
        }
        items++;
        idealPerItem += Math.ceil(itemTris[i] / 124);
      }
      for (const b of staging) {
        b.unmap();
        b.destroy();
      }
      out.push({
        name: m.name,
        meshlets: m.meshletCount,
        tris,
        hist,
        items,
        idealPerItem,
        idealCrossItem: Math.ceil(tris / 124),
        geoBytes: m.vertexBuf.size + m.indexBuf.size + m.normalBuf.size,
        recordBytes: m.meshletCount * MESHLET_RECORD_BYTES,
      });
    }
    return out;
  }

  /** Global id-buffer value -> (model index, dense local item). null = background. */
  itemFromGlobalId(id: number): { model: number; item: number } | null {
    if (id === 0) {
      return null;
    }
    for (let i = 0; i < this.models.length; i++) {
      const m = this.models[i];
      if (id >= m.itemBase && id < m.itemBase + m.itemCount) {
        return { model: i, item: id - m.itemBase };
      }
    }
    return null;
  }

  /** Tombstone + free specific models (worker indices stay aligned). */
  removeModels(indices: number[]) {
    for (const i of indices) {
      const m = this.models[i];
      if (!m || m.dead) {
        continue;
      }
      m.vertexBuf.destroy();
      m.indexBuf.destroy();
      m.cgColorBuf.destroy();
      m.meshletCullBuf.destroy();
      m.recordBuf1.destroy();
      m.recordBuf2.destroy();
      m.visBuf.destroy();
      m.meshletInfoBuf.destroy();
      m.fullListBuf.destroy();
      m.fullArgsBuf.destroy();
      m.itemStateBuf.destroy();
      m.normalBuf.destroy();
      m.modelUniBuf.destroy();
      m.dead = true;
      m.meshletCount = 0;
      m.triangleCount = 0;
    }
    this.lastKey = ''; // force re-render without the removed geometry
  }

  /** Unload every model and release its GPU buffers. */
  clearModels() {
    for (const m of this.models) {
      if (m.dead) {
        continue;
      }
      m.vertexBuf.destroy();
      m.indexBuf.destroy();
      m.cgColorBuf.destroy();
      m.meshletCullBuf.destroy();
      m.recordBuf1.destroy();
      m.recordBuf2.destroy();
      m.visBuf.destroy();
      m.meshletInfoBuf.destroy();
      m.fullListBuf.destroy();
      m.fullArgsBuf.destroy();
      m.itemStateBuf.destroy();
      m.normalBuf.destroy();
      m.modelUniBuf.destroy();
    }
    this.models = [];
    this.nextItemBase = 1;
    this.hadFirstFit = false;
    this.sceneMin = [Infinity, Infinity, Infinity];
    this.sceneMax = [-Infinity, -Infinity, -Infinity];
    this.drawnPass1 = 0;
    this.drawnPass2 = 0;
    this.lastKey = ''; // force a re-render (clears the viewport)
  }

  // Read back the picked depth, unproject to world space, re-pivot the camera.
  // (sx, sy) index the copied texture (HZB mip 0 is half-res); (x, y) is the
  // full-res pixel used for unprojection.
  private async resolvePick(p: PendingPick, sx: number, sy: number, rowWords: number) {
    const buf = this.pickBuf!;
    await buf.mapAsync(GPUMapMode.READ);
    const depths = new Float32Array(buf.getMappedRange()).slice(); // copy before unmap
    buf.unmap();
    this.pickInFlight = false;
    const depth = depths[sy * rowWords + sx];
    const probeDone = (pt: [number, number, number] | null) => {
      this.probeResolve?.(pt);
      this.probeResolve = null;
    };
    const measureDone = (m: MeasureProbe | null) => {
      this.measureResolve?.(m);
      this.measureResolve = null;
    };
    const inv = invert4(this.lastVP);
    if (depth <= 0 || !inv) {
      probeDone(null);
      measureDone(null);
      return; // reversed-Z: 0 = background, nothing hit
    }
    const canvas = this.hostCanvas;
    // Unproject a full-res pixel (fx, fy) + depth to world; null if degenerate.
    const unproj = (fx: number, fy: number, d: number): [number, number, number] | null => {
      const ndcX = ((fx + 0.5) / canvas.width) * 2 - 1;
      const ndcY = 1 - ((fy + 0.5) / canvas.height) * 2;
      const c = [ndcX, ndcY, d, 1];
      const w = new Float32Array(4);
      for (let r = 0; r < 4; r++) {
        w[r] = inv[r] * c[0] + inv[4 + r] * c[1] + inv[8 + r] * c[2] + inv[12 + r] * c[3];
      }
      if (Math.abs(w[3]) < 1e-12) {
        return null;
      }
      return [w[0] / w[3], w[1] / w[3], w[2] / w[3]];
    };
    const point = unproj(p.x, p.y, depth);
    if (!point) {
      probeDone(null);
      measureDone(null);
      return;
    }
    this.lastClickWorld = point; // every successful pick remembers its point

    if (p.mode === 'measure') {
      // True mesh ray-cast (port of the native measure_snap compute): exact,
      // view-independent corner/edge/face. Face fallback on a miss/failure.
      const probe = await this.raycastMeasure(p.x, p.y).catch(() => null);
      measureDone(probe ?? { point, normal: null, edgeDir: null, kind: 'face' });
    } else {
      probeDone(point);
      if (p.mode === 'fly') {
        this.camera.flyTo(point); // Space+LMB
      } else if (p.mode === 'pivot') {
        this.camera.rePivot(point); // Alt+LMB
      }
    }
  }

  // Measurement snap — port of the native measure_snap compute + CPU classify:
  // cast the cursor sight-line against every model's triangles on the GPU
  // (Möller–Trumbore, two-pass atomic arg-min), then classify the closest hit as
  // corner / edge / face from screen-space pixel distances to the triangle's
  // vertices / edges. Returns null on a miss (caller falls back to Face).
  private async raycastMeasure(px: number, py: number): Promise<MeasureProbe | null> {
    if (this.snapInFlight || this.models.length === 0) {
      return null;
    }
    // sight line through the cursor pixel: near-plane origin (correct for both
    // perspective and ortho — a camera-position ray in ortho would be oblique)
    const ray = this.screenRay(px / this.dpr, py / this.dpr);
    if (!ray) {
      return null;
    }
    this.snapInFlight = true;
    try {
      const dev = this.device;
      const params = new Float32Array(8);
      params.set(ray.origin, 0);
      params.set(ray.dir, 4);
      dev.queue.writeBuffer(this.snapParamsBuf, 0, params);
      // clear: t = 0xFFFFFFFF for the atomicMin, everything else 0
      const clear = new Uint32Array(16);
      clear[0] = 0xffffffff;
      dev.queue.writeBuffer(this.snapResultBuf, 0, clear);

      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      // pass 1 (min) over all models, then pass 2 (write) — WebGPU's implicit
      // barriers between dispatches make result[0] the global minimum first
      for (const pipeline of [this.snapMinPipeline, this.snapWritePipeline]) {
        pass.setPipeline(pipeline);
        for (const m of this.models) {
          if (m.dead || m.meshletCount === 0) {
            continue;
          }
          m.snapBind ??= dev.createBindGroup({
            label: 'modelSnapBind',
            layout: this.snapBGL,
            entries: [
              { binding: 0, resource: { buffer: this.snapResultBuf } },
              { binding: 1, resource: { buffer: m.meshletCullBuf } },
              { binding: 2, resource: { buffer: m.meshletInfoBuf } },
              { binding: 3, resource: { buffer: m.indexBuf } },
              { binding: 4, resource: { buffer: m.vertexBuf } },
              { binding: 5, resource: { buffer: m.itemStateBuf } },
              { binding: 6, resource: { buffer: this.transformsBuf } },
              { binding: 7, resource: { buffer: this.snapParamsBuf } },
            ],
          });
          pass.setBindGroup(0, m.snapBind);
          pass.dispatchWorkgroups(Math.ceil(m.meshletCount / 64));
        }
      }
      pass.end();
      enc.copyBufferToBuffer(this.snapResultBuf, 0, this.snapStagingBuf, 0, 64);
      dev.queue.submit([enc.finish()]);

      await this.snapStagingBuf.mapAsync(GPUMapMode.READ);
      const words = new Uint32Array(this.snapStagingBuf.getMappedRange()).slice();
      this.snapStagingBuf.unmap();
      if (words[1] === 0) {
        return null; // no triangle hit
      }
      const f = new Float32Array(words.buffer);
      const A: [number, number, number] = [f[4], f[5], f[6]];
      const B: [number, number, number] = [f[7], f[8], f[9]];
      const C: [number, number, number] = [f[10], f[11], f[12]];
      return classifySnap(A, B, C, f[2], f[3], ray.dir, px, py, this.measureSnap, (p) => this.worldToPixel(p));
    } finally {
      this.snapInFlight = false;
    }
  }

  /** World point → device-pixel coords (same convention as the rasterizer);
   *  null when at/behind the projection plane. */
  private worldToPixel(p: [number, number, number]): [number, number] | null {
    const canvas = this.hostCanvas;
    return projectToScreen(this.lastVP, canvas.width, canvas.height, p);
  }

  private async resolveStats(bytes: number, word: number) {
    await this.statsBuf.mapAsync(GPUMapMode.READ, 0, bytes);
    const counts = new Uint32Array(this.statsBuf.getMappedRange(0, bytes));
    if (this.drawnPerModel.length < this.models.length) {
      this.drawnPerModel = new Uint32Array(this.models.length);
    }
    let p1 = 0,
      p2 = 0;
    for (let i = 0; i < this.models.length; i++) {
      const m1 = counts[(i * COUNT_SLOT * 2) / 4 + word];
      const m2 = counts[(i * COUNT_SLOT * 2 + COUNT_SLOT) / 4 + word];
      this.drawnPerModel[i] = m1 + m2;
      p1 += m1;
      p2 += m2;
    }
    this.statsBuf.unmap();
    this.statsInFlight = false;
    this.drawnPass1 = p1;
    this.drawnPass2 = p2;
  }

  // (Re)create depth / offscreen color / MSAA targets, the HZB pyramid and the
  // dependent bind groups for the current canvas size and MSAA setting.
  private rebuildTargets(w: number, h: number, msaa: boolean, wantPost: boolean, wantAo: boolean) {
    const dev = this.device;
    this.depth?.destroy();
    this.sceneColor?.destroy();
    this.msColor?.destroy();
    this.normalTex?.destroy();
    this.idTex?.destroy();
    this.histA?.destroy();
    this.histB?.destroy();
    this.msColor = null;
    this.normalTex = null;
    this.idTex = null;
    this.targetsMsaa = msaa;
    this.targetsPost = wantPost;
    this.targetsAo = wantAo;
    this.accumIdx = 0;

    this.depth = dev.createTexture({
      label: 'depthTex',
      size: [w, h],
      format: 'depth32float',
      sampleCount: msaa ? 4 : 1,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | (msaa ? 0 : GPUTextureUsage.COPY_SRC),
    });
    this.sceneColor = dev.createTexture({
      label: 'sceneColorTex',
      size: [w, h],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    if (msaa) {
      this.msColor = dev.createTexture({
        label: 'msColorTex',
        size: [w, h],
        format: this.format,
        sampleCount: 4,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    // G-buffer matches the scene sample count; the edge pass reads it
    // per sample under MSAA (id packed in rgba8unorm — no integer MSAA).
    const mkGbuf = (copySrc: boolean) =>
      dev.createTexture({
        label: 'gbufTex',
        size: [w, h],
        format: 'rgba8unorm',
        sampleCount: msaa ? 4 : 1,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.TEXTURE_BINDING |
          (copySrc && !msaa ? GPUTextureUsage.COPY_SRC : 0),
      });
    this.normalTex = mkGbuf(false);
    this.idTex = mkGbuf(true); // item picking reads single pixels back

    // VBAO output + temporal history (always single-sample; reads depth sample 0)
    this.aoTex?.destroy();
    this.aoHist?.destroy();
    // aoTex/aoHist are storage+sampled only (never attachments): 1×1 dummies
    // keep every bind group valid while VBAO is off — 8 B/px reclaimed
    const mkAo = () =>
      dev.createTexture({
        label: 'aoTex',
        size: wantAo ? [w, h] : [1, 1],
        format: 'r32float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
    this.aoTex = mkAo();
    this.aoHist = mkAo();
    this.aoAccum = 0;
    this.aoBind = dev.createBindGroup({
      label: 'aoBind',
      layout: (msaa ? this.vbaoMsPipeline : this.vbaoPipeline).getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.depth.createView() },
        { binding: 1, resource: this.aoTex.createView() },
        { binding: 2, resource: this.aoHist.createView() },
        { binding: 3, resource: { buffer: this.aoParamsBuf } },
      ],
    });

    // the post pass renders into the history pair (attachment sizes must match
    // the pass), so they are full-size exactly when post runs — 16 B/px back
    // in the plain no-AA/no-edges/no-AO path
    const mkHist = () =>
      dev.createTexture({
        label: 'histTex',
        size: wantPost ? [w, h] : [1, 1],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    this.histA = mkHist();
    this.histB = mkHist();

    const mkPostBind = (history: GPUTexture) => {
      return dev.createBindGroup({
        label: 'postBind',
        layout: (msaa ? this.postMsPipeline : this.postPipeline).getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sceneColor!.createView() },
          { binding: 1, resource: this.depth!.createView() },
          { binding: 2, resource: { buffer: this.postParamsBuf } },
          { binding: 3, resource: history.createView() },
          { binding: 4, resource: this.normalTex!.createView() },
          { binding: 5, resource: this.idTex!.createView() },
          { binding: 6, resource: this.aoTex!.createView() },
        ],
      });
    };
    this.postBindEven = mkPostBind(this.histA);
    this.postBindOdd = mkPostBind(this.histB);

    this.rebuildHzb(w, h, msaa); // used by both the MDI and vertex-pull cull
  }

  private rebuildHzb(w: number, h: number, msaa: boolean) {
    const dev = this.device;
    this.hzb?.destroy();
    const pw = Math.max(1, w >> 1);
    const ph = Math.max(1, h >> 1);
    this.hzbMipCount = Math.floor(Math.log2(Math.max(pw, ph))) + 1;
    this.hzb = dev.createTexture({
      label: 'hzbTex',
      size: [pw, ph],
      format: 'r32float',
      mipLevelCount: this.hzbMipCount,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });

    this.hzbBinds = [];
    this.hzbMipSizes = [];
    for (let i = 0; i < this.hzbMipCount; i++) {
      const firstPipeline = msaa ? this.hzbFirstMsPipeline : this.hzbFirstPipeline;
      const src = i === 0 ? this.depth!.createView() : this.hzb.createView({ baseMipLevel: i - 1, mipLevelCount: 1 });
      this.hzbBinds.push(
        dev.createBindGroup({
          label: 'hzbBind',
          layout: (i === 0 ? firstPipeline : this.hzbDownPipeline).getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: src },
            { binding: 1, resource: this.hzb.createView({ baseMipLevel: i, mipLevelCount: 1 }) },
          ],
        }),
      );
      this.hzbMipSizes.push([Math.max(1, pw >> i), Math.max(1, ph >> i)]);
    }

    this.cull2ParamsBind = dev.createBindGroup({
      label: 'cull2ParamsBind',
      layout: this.cull2Pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: this.hzb.createView() },
        { binding: 3, resource: { buffer: this.clipBuf } },
      ],
    });
    this.cullVp2ParamsBind = dev.createBindGroup({
      label: 'cullVp2ParamsBind',
      layout: this.cullVp2Pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: this.hzb.createView() },
        { binding: 3, resource: { buffer: this.clipBuf } },
      ],
    });
  }

  frame(canvas: HTMLCanvasElement) {
    const t0 = performance.now();
    const dev = this.device;
    const opt = this.options;
    this.timings.enabled = !!opt.gpuTimings;

    const w = (canvas.clientWidth * this.dpr * this.captureScale) | 0;
    const h = (canvas.clientHeight * this.dpr * this.captureScale) | 0;
    const sizeChanged = canvas.width !== w || canvas.height !== h;
    if (sizeChanged) {
      canvas.width = w;
      canvas.height = h;
    }
    // post is needed by AA/edges/AO/debug/sketch — and it is what makes the
    // hold path possible (it re-presents the offscreen scene into the swapchain)
    const anyEdges = opt.geoEdges || opt.itemEdges || opt.sketch;
    const usePost = opt.fastAA || anyEdges || opt.msaa4x || opt.debugBuf > 0 || opt.aoMode !== 0;
    // debug view 5 dispatches VBAO for display even with aoMode off
    const needAo = opt.aoMode !== 0 || opt.debugBuf === 5;
    if (
      sizeChanged ||
      !this.depth ||
      this.targetsMsaa !== opt.msaa4x ||
      this.targetsPost !== usePost ||
      this.targetsAo !== needAo
    ) {
      this.rebuildTargets(canvas.width, canvas.height, opt.msaa4x, usePost, needAo);
    }

    const now0 = performance.now();
    this.camera.update(Math.min(0.1, (now0 - this.lastFrame) / 1000));
    this.lastFrame = now0;

    this.camera.ortho = opt.orthographic;
    if (opt.orthographic) {
      // per-frame depth slab: scene AABB corners projected onto the view axis
      // (native frame.rs ortho setup)
      const eye = this.camera.eye();
      const fwd = this.camera.forward();
      let dMin = Infinity,
        dMax = -Infinity;
      for (let c = 0; c < 8; c++) {
        const x = (c & 1 ? this.sceneMax : this.sceneMin)[0] - eye[0];
        const y = (c & 2 ? this.sceneMax : this.sceneMin)[1] - eye[1];
        const z = (c & 4 ? this.sceneMax : this.sceneMin)[2] - eye[2];
        const d = x * fwd[0] + y * fwd[1] + z * fwd[2];
        dMin = Math.min(dMin, d);
        dMax = Math.max(dMax, d);
      }
      if (!Number.isFinite(dMin)) {
        dMin = 0.1;
        dMax = 100;
      }
      const margin = Math.max(dMax - dMin, 1) * 0.05 + 0.5;
      this.camera.orthoNear = dMin - margin;
      this.camera.orthoFar = dMax + margin;
    }

    const vp = this.camera.viewProj(canvas.width / canvas.height);

    // px cut only applies while the camera is moving; the first still frame
    // re-renders at full quality (pxCut change alters the key), then goes idle.
    const vpKey = `${vp.join(',')};${canvas.width}x${canvas.height};${this.models.length}`;
    const moving = vpKey !== this.lastVpKey;
    this.lastVpKey = vpKey;
    if (moving) {
      this.lastMoveT = performance.now();
    }
    const pxCut = moving || this.wasMoving ? opt.pxCut : 0;
    this.wasMoving = moving;
    const key =
      `${vpKey};${pxCut};${opt.meshletVis};${opt.protectDist};` +
      `${opt.fastAA};${opt.msaa4x};${opt.freezeCull};` +
      `${opt.geoEdges};${opt.itemEdges};${opt.sketch};${opt.edgeColor.join(',')};${opt.fadeExp};` +
      `${opt.depthThr};${opt.normalThr};${opt.whiteOnDark};${opt.darkThr};${opt.debugBuf};` +
      `${opt.smoothDepthThr};${opt.smoothNormalThr};${opt.smoothFadeExp};` +
      `${opt.flatMeshEdges};${opt.smoothMeshEdges};${opt.sketchRespectsEdgesOff};${opt.sketchColorMode};` +
      `${opt.aoMode};${opt.aoRadius};${opt.aoStrength};${opt.aoSlices};${opt.aoSamples};` +
      `${opt.bgColor.join(',')};${opt.ambientColor.join(',')};${opt.ambientIntensity};` +
      `${opt.headlightColor.join(',')};${opt.headlightIntensity};${opt.vertexPull};` +
      `${opt.selectionColor.join(',')};${opt.suppressTintOnOverride};${this.stateVersion};${this.clipVersion};` +
      `${opt.transparencyBlend};${opt.hasTransparency};${opt.aaSamples};` +
      // outline: static options only — the hover id and pulse phase go through
      // the hold path instead so they never reset TAA/AO accumulation
      `${opt.outlineHover};${opt.outlineSelection};${opt.selectionTint};${opt.outlineStrength};` +
      `${opt.outlineGlow};${opt.outlineThickness};${opt.outlinePulse};${opt.outlineSelectionActive};` +
      `${opt.outlineVisibleColor.join(',')};${opt.outlineHiddenColor.join(',')};` +
      // view cube hover/position/palette must break the idle skip or the
      // overlay freezes once TAA converges (hover highlight, handle drags,
      // Settings colour changes)
      this.viewCube.stateKey;

    // outline effect: is anything outlined, and does it need frames beyond
    // convergence (hover changed, or the pulse animation is running)?
    const effHover = opt.outlineHover ? this.hoverItemId : 0;
    const outlineOn =
      this.models.length > 0 && (effHover !== 0 || (opt.outlineSelection && opt.outlineSelectionActive));
    const outlineWork = (opt.outlineHover && effHover !== this.drawnHoverId) || (outlineOn && opt.outlinePulse > 0);

    // Idle / TAA accumulation. While the scene is unchanged, TAA keeps
    // rendering jittered frames into the running average until converged;
    // only then (or immediately without TAA) does the renderer go idle.
    // Converged frames forced anyway (outline hover/pulse, picks, snapshots)
    // take the HOLD path: skip the scene re-render, re-present the converged
    // accumulation, and draw only the overlays — so animated overlays never
    // corrupt or restart the accumulated image (native hover-fast-path idea).
    let hold = false;
    if (key === this.lastKey) {
      const taaConverged = !opt.fastAA || this.accumIdx >= this.aaMax - 1;
      const aoConverged = opt.aoMode === 0 || this.aoAccum >= this.aaMax - 1;
      if (
        taaConverged &&
        aoConverged &&
        !this.pendingPick &&
        !this.pendingSnap &&
        !this.itemPick.hasPending &&
        !outlineWork
      ) {
        this.idle = true;
        this.frames = 0;
        this.lastStat = performance.now();
        return;
      }
      if (!taaConverged && opt.fastAA) {
        this.accumIdx++;
      }
      if (!aoConverged && opt.aoMode !== 0) {
        this.aoAccum++;
      }
      hold = usePost && taaConverged && aoConverged;
    } else {
      this.accumIdx = 0; // scene changed: restart accumulation
      this.aoAccum = 0;
    }
    this.lastKey = key;
    this.idle = false;
    this.accumCount = opt.fastAA ? this.accumIdx + 1 : 0;
    // this frame completes accumulation → it's the one a snapshot may capture
    // (same convergence terms as the idle check above)
    const snapReady =
      (!opt.fastAA || this.accumIdx >= this.aaMax - 1) && (opt.aoMode === 0 || this.aoAccum >= this.aaMax - 1);

    // lastVP holds the STABLE (un-jittered) matrix. The label overlay (boxes +
    // leader lines), picking and world→screen projection all read it via
    // viewProjMatrix — the TAA jitter below must NOT leak into that host-side
    // math, or labels and leader lines shimmer sub-pixel while AA accumulates.
    // Only the GPU frame buffer gets the jittered copy.
    this.lastVP.set(vp);

    // Sub-pixel projection jitter (Halton 2,3) while accumulating. Applied
    // after the change check so jitter itself never counts as camera motion.
    let jx = 0;
    let jy = 0;
    if (opt.fastAA) {
      const halton = (i: number, b: number) => {
        let f = 1,
          r = 0;
        while (i > 0) {
          f /= b;
          r += f * (i % b);
          i = Math.floor(i / b);
        }
        return r;
      };
      jx = ((halton(this.accumIdx + 1, 2) - 0.5) * 2) / canvas.width;
      jy = ((halton(this.accumIdx + 1, 3) - 0.5) * 2) / canvas.height;
      for (let c = 0; c < 4; c++) {
        vp[c * 4 + 0] += jx * vp[c * 4 + 3];
        vp[c * 4 + 1] += jy * vp[c * 4 + 3];
      }
    }

    const eye = this.camera.eye();
    // CAMERA-RELATIVE RENDERING: the GPU gets the world rebased on a per-frame
    // origin near the camera, because an absolute f32 coordinate resolves only
    // ~1 mm at 10 km — enough to z-fight coincident faces AND to wreck the
    // screen-space derivative the flat shading takes its face normal from.
    // The origin is the eye ROUNDED, so it only changes when the camera has
    // moved a whole unit (a stable basis frame to frame, which keeps TAA
    // accumulation from seeing the rebase as motion). lastVP / lastView stay
    // ABSOLUTE — host-side picking, the label overlay and the cull pass all
    // work in world space.
    const origin: [number, number, number] = [Math.round(eye[0]), Math.round(eye[1]), Math.round(eye[2])];
    const vpRel = this.camera.viewProjRelative(canvas.width / canvas.height, origin);
    for (let c = 0; c < 4; c++) {
      vpRel[c * 4 + 0] += jx * vpRel[c * 4 + 3];
      vpRel[c * 4 + 1] += jy * vpRel[c * 4 + 3];
    }
    const frameData = new ArrayBuffer(FRAME_SIZE);
    const ff = new Float32Array(frameData);
    ff.set(vpRel, FRAME_SLOT.viewProj);
    ff.set([...origin, 0], FRAME_SLOT.origin);
    ff.set([eye[0] - origin[0], eye[1] - origin[1], eye[2] - origin[2], 1], FRAME_SLOT.eye);
    const fu = new Uint32Array(frameData);
    fu[FRAME_SLOT.flags] = opt.meshletVis ? 1 : 0;
    fu[FRAME_SLOT.flags + 1] = opt.suppressTintOnOverride ? 1 : 0;
    fu[FRAME_SLOT.flags + 2] = opt.transparencyBlend ? 1 : 0; // bit1 (blend pass) set in slot 2
    fu[FRAME_SLOT.flags + 3] = this.accumIdx; // alpha-hash seed
    // ortho: directional headlight along the view axis (surface -> light = -fwd)
    const fwd = this.camera.forward();
    ff.set([-fwd[0], -fwd[1], -fwd[2], opt.orthographic ? 1 : 0], FRAME_SLOT.light);
    ff.set([...opt.ambientColor, opt.ambientIntensity], FRAME_SLOT.ambient);
    ff.set([...opt.headlightColor, opt.headlightIntensity], FRAME_SLOT.headlight);
    // selection REPLACES the color (a = blend); outline-only style zeroes the
    // blend so selected items keep their true color (outline shows instead)
    ff.set([...opt.selectionColor, opt.selectionTint ? 1.0 : 0.0], FRAME_SLOT.selColor);
    dev.queue.writeBuffer(this.frameBuf, 0, frameData);
    fu[FRAME_SLOT.flags + 2] |= 2; // blend-pass slot
    dev.queue.writeBuffer(this.frameBuf, 256, frameData);

    // vp = vertex pulling (core WebGPU); mdi = multi-draw indirect (feature);
    // full = no culling, static all-meshlets vertex-pull draw
    const cullMode: 'mdi' | 'vp' | 'full' = opt.vertexPull ? 'vp' : this.multiDraw ? 'mdi' : 'full';
    this.cullMode = cullMode;
    const cullActive = cullMode !== 'full' && this.models.length > 0 && !opt.freezeCull && !hold;

    if (cullActive) {
      // (cull params below are only consumed by the cull dispatches)
      const params = new ArrayBuffer(PARAMS_SIZE);
      const pf = new Float32Array(params);
      pf.set(this.frustumPlanes(vp), 0); // 0..24
      pf.set(this.camera.lastView, 24); // 24..40
      pf.set([...eye, 1], 40); // 40..44
      pf[44] = this.camera.lastP00;
      pf[45] = this.camera.lastP11;
      pf[46] = this.camera.near;
      pf[47] = this.hzbMipCount;
      pf[48] = this.hzbMipSizes[0]?.[0] ?? 1;
      pf[49] = this.hzbMipSizes[0]?.[1] ?? 1;
      pf[50] = pxCut;
      pf[51] = opt.protectDist;
      pf[52] = canvas.height;
      new Uint32Array(params)[53] = opt.orthographic ? 1 : 0;
      pf[54] = this.camera.orthoNear;
      pf[55] = this.camera.orthoFar;
      dev.queue.writeBuffer(this.paramsBuf, 0, params);
    }

    // AO runs in Motion mode every frame, in Static mode only while the camera
    // is still. Static+moving neither computes NOR applies AO (a stale buffer
    // would ghost old-viewpoint shadows onto new geometry), and when the
    // dispatch resumes the accumulator restarts so blend=1 overwrites history.
    const aoActive = opt.aoMode === 1 || (opt.aoMode === 2 && !moving && this.models.length > 0);
    if (aoActive && !this.aoRanLastFrame) {
      this.aoAccum = 0;
    }
    this.aoRanLastFrame = aoActive;

    if (usePost) {
      const pp = new ArrayBuffer(80);
      const pu = new Uint32Array(pp);
      const pf = new Float32Array(pp);
      pu[0] = this.accumIdx;
      pu[1] = this.accumIdx + 1;
      // the raw-edge debug view needs both edge signals computed
      const dbgEdges = opt.debugBuf === 4;
      pu[2] =
        (opt.geoEdges || dbgEdges || opt.sketch ? 1 : 0) |
        (opt.itemEdges || dbgEdges || opt.sketch ? 2 : 0) |
        (opt.fastAA ? 4 : 0) |
        (opt.whiteOnDark ? 8 : 0) |
        ((opt.debugBuf & 7) << 4) |
        (aoActive || opt.debugBuf === 5 ? 256 : 0) |
        (opt.orthographic ? 512 : 0) |
        (hold && opt.fastAA ? 1024 : 0) | // re-present the sum, don't accumulate
        (opt.sketch ? 2048 : 0) | // white paper, black edge lines
        (opt.smoothMeshEdges ? 0 : 4096) | // smooth-mesh edge lines OFF
        (opt.flatMeshEdges ? 0 : 8192) | // flat-mesh edge lines OFF
        (opt.sketchRespectsEdgesOff ? 16384 : 0) |
        (opt.sketch && opt.sketchColorMode === 'fill' ? 32768 : 0) |
        (opt.sketch && opt.sketchColorMode === 'edges' ? 65536 : 0);
      pf[3] = this.camera.near;
      pf.set([...opt.edgeColor, 1], 4);
      pf[8] = opt.depthThr;
      pf[9] = opt.normalThr;
      pf[10] = opt.fadeExp;
      pf[11] = opt.darkThr;
      pf[12] = opt.debugBuf === 5 ? 0 : opt.aoStrength; // debug view shows raw buffer
      pf[13] = this.camera.orthoNear;
      pf[14] = this.camera.orthoFar;
      pf[15] = this.camera.focusDist;
      // smooth-mesh (authored normals) edge tuning
      pf[16] = opt.smoothDepthThr;
      pf[17] = opt.smoothNormalThr;
      pf[18] = opt.smoothFadeExp;
      dev.queue.writeBuffer(this.postParamsBuf, 0, pp);
    }

    if (aoActive || opt.debugBuf === 5) {
      const ap = new ArrayBuffer(64);
      const af = new Float32Array(ap);
      const au = new Uint32Array(ap);
      af[0] = 1 / canvas.width;
      af[1] = 1 / canvas.height;
      af[2] = opt.aoRadius;
      af[3] = 0.1; // ao_bias: min elevation above tangent plane
      au[4] = this.aoAccum; // seed: fixed while moving -> stable noise pattern
      au[5] = Math.max(1, opt.aoSlices);
      au[6] = Math.max(1, Math.min(12, opt.aoSamples));
      af[7] = 1 / (this.aoAccum + 1); // blend: running average like native
      af[8] = this.camera.near;
      af[9] = 0.5; // thickness_m: occluder slab depth
      af[10] = this.camera.lastP00;
      af[11] = this.camera.lastP11;
      au[12] = opt.orthographic ? 1 : 0;
      af[13] = this.camera.orthoHalfH;
      af[14] = this.camera.orthoNear;
      af[15] = this.camera.orthoFar;
      dev.queue.writeBuffer(this.aoParamsBuf, 0, ap);
    }

    const enc = dev.createCommandEncoder();
    const swapTex = this.context.getCurrentTexture();
    const swapView = swapTex.createView();
    const sceneView = usePost ? this.sceneColor!.createView() : swapView;
    const clearColor = { r: opt.bgColor[0], g: opt.bgColor[1], b: opt.bgColor[2], a: 1 };
    const renderPipeline = opt.msaa4x ? this.renderPipeline4x : this.renderPipeline1x;

    // Scene pass attachments: with MSAA render into the 4x target and resolve
    // into the post input; without MSAA also write the G-buffer (normal + id)
    // consumed by the edge pass.
    const sceneAttachments = (clear: boolean): GPURenderPassColorAttachment[] => {
      const load: GPULoadOp = clear ? 'clear' : 'load';
      const color: GPURenderPassColorAttachment = opt.msaa4x
        ? {
            view: this.msColor!.createView(),
            resolveTarget: sceneView,
            clearValue: clearColor,
            loadOp: load,
            storeOp: 'store',
          }
        : { view: sceneView, clearValue: clearColor, loadOp: load, storeOp: 'store' };
      return [
        color,
        {
          view: this.normalTex!.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: load,
          storeOp: 'store',
        },
        {
          view: this.idTex!.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: load,
          storeOp: 'store',
        },
      ];
    };
    const depthAttachment = (clear: boolean): GPURenderPassDepthStencilAttachment => ({
      view: this.depth!.createView(),
      depthClearValue: 0, // reversed-Z
      depthLoadOp: clear ? 'clear' : 'load',
      depthStoreOp: 'store',
    });

    const vpPipeline = opt.msaa4x ? this.renderVpPipeline4x : this.renderVpPipeline1x;
    const blendPipeline = opt.msaa4x ? this.renderBlend4x : this.renderBlend1x;
    const vpBlendPipeline = opt.msaa4x ? this.renderVpBlend4x : this.renderVpBlend1x;
    // draw all models with the mode's submission (pass = 1 or 2);
    // blend=true replays the same records through the transparency pipeline
    // (frame-uniform slot 1 routes transparent items in, opaque out)
    const drawScene = (pass: GPURenderPassEncoder, passIdx: 1 | 2, blend = false) => {
      const frameOffset = [blend ? 256 : 0];
      if (cullMode === 'mdi') {
        pass.setPipeline(blend ? blendPipeline : renderPipeline);
        for (const m of this.models) {
          // meshletCount 0 also covers a fully-cut coarse variant, whose
          // minimum-sized geometry buffers would fail draw-time binding checks
          if (m.dead || m.meshletCount === 0) {
            continue;
          }
          pass.setBindGroup(0, m.renderBind, frameOffset);
          pass.setVertexBuffer(0, m.vertexBuf);
          pass.setIndexBuffer(m.indexBuf, 'uint16');
          const [buf, off] = passIdx === 1 ? [m.recordBuf1, m.countOffset1] : [m.recordBuf2, m.countOffset2];
          (
            pass as unknown as {
              multiDrawIndexedIndirect(b: GPUBuffer, o: number, max: number, cb: GPUBuffer, co: number): void;
            }
          ).multiDrawIndexedIndirect(buf, 0, m.meshletCount, this.countsBuf, off);
        }
      } else {
        pass.setPipeline(blend ? vpBlendPipeline : vpPipeline);
        for (const m of this.models) {
          if (m.dead || m.meshletCount === 0) {
            continue;
          }
          pass.setBindGroup(0, m.renderBind, frameOffset);
          if (cullMode === 'vp') {
            pass.setBindGroup(1, passIdx === 1 ? m.vpGeoBind1 : m.vpGeoBind2);
            pass.drawIndirect(this.countsBuf, passIdx === 1 ? m.countOffset1 : m.countOffset2);
          } else {
            // full: static all-meshlets list, no culling
            pass.setBindGroup(1, m.vpGeoBindFull);
            pass.drawIndirect(m.fullArgsBuf, 0);
          }
        }
      }
    };
    // transparency pass (blend mode only): replay both record sets blended
    const drawBlendPass = (enc2: GPUCommandEncoder) => {
      if (!opt.transparencyBlend || !opt.hasTransparency || this.models.length === 0) {
        return;
      }
      const pass = enc2.beginRenderPass({
        colorAttachments: sceneAttachments(false),
        depthStencilAttachment: depthAttachment(false),
        timestampWrites: this.timings.writes(5),
      });
      drawScene(pass, 1, true);
      if (cullMode !== 'full') {
        drawScene(pass, 2, true);
      }
      pass.end();
    };

    if (hold) {
      // hold path: the scene, G-buffer, depth, HZB, AO and history all still
      // hold the converged frame — nothing scene-side is encoded at all. Post
      // (below) re-presents the accumulation; only overlays render fresh.
    } else if (cullMode !== 'full' && this.models.length > 0) {
      const vp = cullMode === 'vp';
      if (cullActive) {
        enc.clearBuffer(this.countsBuf, 0, this.models.length * COUNT_SLOT * 2);

        // cull pass 1: meshlets visible last frame, frustum + cone
        const cull1 = enc.beginComputePass({ timestampWrites: this.timings.writes(0) });
        cull1.setPipeline(vp ? this.cullVp1Pipeline : this.cull1Pipeline);
        cull1.setBindGroup(1, vp ? this.cullVp1ParamsBind : this.cull1ParamsBind);
        for (const m of this.models) {
          if (m.dead || m.meshletCount === 0) {
            continue;
          }
          cull1.setBindGroup(0, vp ? m.cullVpBind1 : m.cullBind1);
          cull1.dispatchWorkgroups(Math.ceil(m.meshletCount / 64));
        }
        cull1.end();
      }

      // render pass 1 (frozen: replay last frozen records)
      const pass1 = enc.beginRenderPass({
        colorAttachments: sceneAttachments(true),
        depthStencilAttachment: depthAttachment(true),
        timestampWrites: this.timings.writes(1),
      });
      drawScene(pass1, 1);
      pass1.end();

      if (cullActive) {
        // HZB build: min-reduce depth into the pyramid chain
        const hzbPass = enc.beginComputePass({ timestampWrites: this.timings.writes(2) });
        for (let i = 0; i < this.hzbMipCount; i++) {
          hzbPass.setPipeline(
            i === 0 ? (opt.msaa4x ? this.hzbFirstMsPipeline : this.hzbFirstPipeline) : this.hzbDownPipeline,
          );
          hzbPass.setBindGroup(0, this.hzbBinds[i]);
          const [mw, mh] = this.hzbMipSizes[i];
          hzbPass.dispatchWorkgroups(Math.ceil(mw / 8), Math.ceil(mh / 8));
        }
        hzbPass.end();

        // cull pass 2: all meshlets, frustum + cone + occlusion; updates visibility
        const cull2 = enc.beginComputePass({ timestampWrites: this.timings.writes(3) });
        cull2.setPipeline(vp ? this.cullVp2Pipeline : this.cull2Pipeline);
        cull2.setBindGroup(1, vp ? this.cullVp2ParamsBind! : this.cull2ParamsBind!);
        for (const m of this.models) {
          if (m.dead || m.meshletCount === 0) {
            continue;
          }
          cull2.setBindGroup(0, vp ? m.cullVpBind2 : m.cullBind2);
          cull2.dispatchWorkgroups(Math.ceil(m.meshletCount / 64));
        }
        cull2.end();
      }

      // render pass 2: newly visible meshlets on top of pass 1
      const pass2 = enc.beginRenderPass({
        colorAttachments: sceneAttachments(false),
        depthStencilAttachment: depthAttachment(false),
        timestampWrites: this.timings.writes(4),
      });
      drawScene(pass2, 2);
      this.drawHelperLines(pass2, opt.msaa4x);
      pass2.end();

      drawBlendPass(enc);
    } else {
      // no culling available: one static full vertex-pull draw per model
      const pass = enc.beginRenderPass({
        colorAttachments: sceneAttachments(true),
        depthStencilAttachment: depthAttachment(true),
        timestampWrites: this.timings.writes(1),
      });
      drawScene(pass, 1);
      this.drawHelperLines(pass, opt.msaa4x);
      pass.end();

      drawBlendPass(enc);
    }

    if (!hold && (aoActive || (opt.debugBuf === 5 && this.aoAccum === 0))) {
      // VBAO after the final scene pass (depth complete), before the post pass
      const aoPass = enc.beginComputePass({ timestampWrites: this.timings.writes(6) });
      aoPass.setPipeline(opt.msaa4x ? this.vbaoMsPipeline : this.vbaoPipeline);
      aoPass.setBindGroup(0, this.aoBind!);
      aoPass.dispatchWorkgroups(Math.ceil(canvas.width / 8), Math.ceil(canvas.height / 8));
      aoPass.end();
    }

    if (usePost) {
      // history ping-pong: even accumIdx reads histA and writes histB. Hold
      // frames flip the parity so they READ the buffer the converged frame
      // just wrote (the latest sum) and re-write the other — after the first
      // hold frame both buffers carry the final sum, so this stays stable.
      const even = (this.accumIdx % 2 === 0) !== hold;
      const post = enc.beginRenderPass({
        timestampWrites: this.timings.writes(7),
        colorAttachments: [
          { view: swapView, loadOp: 'clear', storeOp: 'store' },
          {
            view: (even ? this.histB! : this.histA!).createView(),
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      post.setPipeline(opt.msaa4x ? this.postMsPipeline : this.postPipeline);
      post.setBindGroup(0, even ? this.postBindEven! : this.postBindOdd!);
      post.draw(3);
      post.end();
    }

    // outline overlay AFTER post (never enters the TAA history — the same
    // reason the native renderer composites its hover outline inside TAA)
    this.drawnHoverId = effHover;
    if (outlineOn) {
      this.outline.encode(
        enc,
        dev,
        canvas,
        opt,
        cullMode,
        frameData,
        this.frameBuf,
        this.countsBuf,
        this.models,
        this.depth!,
        swapView,
        effHover,
        this.timings,
      );
    }

    // view cube on top of the finished frame (after post so TAA never smears it)
    this.viewCube.draw(
      enc,
      swapView,
      canvas,
      this.format,
      this.dpr * this.captureScale,
      !!(this.options.msaa4x || this.options.fastAA),
      this.timings,
    );

    const pickJob = this.encodeDepthPick(enc, dev, canvas, opt, cullMode);

    let statsBytes = 0;
    if (cullActive && !this.statsInFlight && t0 - this.lastCountRead > 500) {
      this.statsInFlight = true;
      this.lastCountRead = t0;
      statsBytes = this.models.length * COUNT_SLOT * 2;
      enc.copyBufferToBuffer(this.countsBuf, 0, this.statsBuf, 0, statsBytes);
    }

    const itemPickJob = this.itemPick.encode(
      enc,
      dev,
      canvas,
      opt,
      cullMode,
      frameData,
      this.frameBuf,
      this.countsBuf,
      this.models,
      this.pickPipeline,
      this.pickVpPipeline,
      this.timings,
    );

    // snapshots copy the presented swapchain (post output + view cube), and
    // only once accumulation has converged — before that the pending snap
    // just keeps the renderer out of idle so it converges
    const snapJob = this.encodeSnapshot(enc, dev, canvas, snapReady, swapTex);
    const tsJob = this.timings.resolve(enc);

    dev.queue.submit([enc.finish()]);
    pickJob?.();
    snapJob?.();
    itemPickJob?.();
    tsJob?.();
    if (statsBytes > 0) {
      // vp mode: the counter is instanceCount, word 1 of the args block
      this.resolveStats(statsBytes, cullMode === 'vp' ? 1 : 0).catch(() => (this.statsInFlight = false));
    }

    this.cpuMs = this.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    this.frames++;
    const now = performance.now();
    if (now - this.lastStat > 500) {
      this.fps = (this.frames * 1000) / (now - this.lastStat);
      this.frames = 0;
      this.lastStat = now;
    }
  }

  /** Encode the depth-pick copy (Space/Alt/probe/measure aim). Returns the
   *  post-submit resolve job, or null. */
  private encodeDepthPick(
    enc: GPUCommandEncoder,
    dev: GPUDevice,
    canvas: HTMLCanvasElement,
    opt: Renderer['options'],
    cullMode: 'mdi' | 'vp' | 'full',
  ): (() => void) | null {
    // Depth pick: HZB mip 0 in MDI mode (always copyable), raw depth otherwise.
    // Only the ONE texel under the cursor is copied — resolvePick reads a
    // single depth, and measure hover fires this per mousemove, so a
    // full-surface copy here was megabytes of readback traffic per event.
    let pickJob: (() => void) | null = null;
    if (this.pendingPick && !this.pickInFlight) {
      const pick = this.pendingPick;
      this.pendingPick = null;
      // pick.x/y were clamped against the canvas at queue time; a resize since
      // then can shrink the source texture, so clamp again at encode time.
      let src: { texture: GPUTexture; mipLevel: number; origin: [number, number] } | null = null;
      if (cullMode !== 'full' && this.hzb) {
        const [pw, ph] = this.hzbMipSizes[0]; // half-res: cursor px >> 1
        src = {
          texture: this.hzb,
          mipLevel: 0,
          origin: [Math.min(pick.x >> 1, pw - 1), Math.min(pick.y >> 1, ph - 1)],
        };
      } else if (!opt.msaa4x) {
        src = {
          texture: this.depth!,
          mipLevel: 0,
          origin: [Math.min(pick.x, canvas.width - 1), Math.min(pick.y, canvas.height - 1)],
        };
      }
      // fallback + MSAA: multisampled depth is not copyable; pick unsupported
      if (src) {
        this.pickBuf ??= dev.createBuffer({
          label: 'pickBuf',
          size: 256, // one f32 texel; 256 keeps the copy/map alignment rules trivial
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        enc.copyTextureToBuffer(src, { buffer: this.pickBuf }, [1, 1]);
        this.pickInFlight = true;
        pickJob = () => this.resolvePick(pick, 0, 0, 1).catch(() => (this.pickInFlight = false));
      }
    }

    return pickJob;
  }

  /** Encode the one-shot frame snapshot copy — the presented swapchain, once
   *  `ready` (accumulation converged). Returns the post-submit resolve job,
   *  or null. An unconsumed pendingSnap keeps blocking the idle skip, so the
   *  renderer converges and a later frame captures. */
  private encodeSnapshot(
    enc: GPUCommandEncoder,
    dev: GPUDevice,
    canvas: HTMLCanvasElement,
    ready: boolean,
    swapTex: GPUTexture,
  ): (() => void) | null {
    let snapJob: (() => void) | null = null;
    if (this.pendingSnap && ready) {
      const resolve = this.pendingSnap;
      this.pendingSnap = null;
      const rowBytes = Math.ceil((canvas.width * 4) / 256) * 256;
      const snapBuf = dev.createBuffer({
        label: 'snapBuf',
        size: rowBytes * canvas.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      // the swapchain (configured COPY_SRC) holds the finished frame here:
      // post ran into it and the view cube is drawn — WYSIWYG
      enc.copyTextureToBuffer({ texture: swapTex }, { buffer: snapBuf, bytesPerRow: rowBytes }, [
        canvas.width,
        canvas.height,
      ]);
      const w = canvas.width,
        h = canvas.height;
      const bgra = this.format.startsWith('bgra');
      snapJob = async () => {
        await snapBuf.mapAsync(GPUMapMode.READ);
        const src = new Uint8Array(snapBuf.getMappedRange());
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const s = y * rowBytes + x * 4;
            const d = (y * w + x) * 4;
            rgba[d + 0] = src[s + (bgra ? 2 : 0)];
            rgba[d + 1] = src[s + 1];
            rgba[d + 2] = src[s + (bgra ? 0 : 2)];
            rgba[d + 3] = 255;
          }
        }
        snapBuf.destroy();
        resolve({ w, h, rgba });
      };
    }

    return snapJob;
  }

  /** Position/hover/orientation of the canvas view cube for this frame.
   *  `rect` = the DOM gizmo's stage box in CSS px (null hides the cube);
   *  `q` = the same camera quaternion the DOM gizmo gets. */
  setViewCube(
    rect: { x: number; y: number; size: number } | null,
    hover: number,
    q: { x: number; y: number; z: number; w: number },
  ) {
    this.viewCube.setPlacement(rect, hover, q);
  }

  /** Change the cube's face labels (rebuilds the label atlas lazily). */
  setViewCubeLabels(labels: Partial<Record<GizmoFace, string>>) {
    this.viewCube.setLabels(labels);
  }

  /** Cube palette (settings-driven; sketch mode passes its own set). The bevel
   *  plates take the face colour slightly lifted, like the original two-tone. */
  setViewCubeColors(
    face: [number, number, number],
    line: [number, number, number],
    hover: [number, number, number],
    text: string,
  ) {
    this.viewCube.setColors(face, line, hover, text);
  }

  private drawHelperLines(pass: GPURenderPassEncoder, msaa: boolean) {
    if (this.lineCount === 0 || !this.lineBuf) {
      return;
    }
    pass.setPipeline(msaa ? this.linePipeline4x : this.linePipeline1x);
    pass.setBindGroup(0, this.lineBind);
    pass.setVertexBuffer(0, this.lineBuf);
    pass.draw(this.lineCount);
  }

  // Extract world-space frustum planes from a column-major view-proj matrix.
  private frustumPlanes(m: Float32Array): Float32Array {
    const p = new Float32Array(24);
    const row = (r: number) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
    const w = row(3);
    const set = (i: number, a: number[], sign: number) => {
      const px = w[0] + sign * a[0],
        py = w[1] + sign * a[1],
        pz = w[2] + sign * a[2],
        pw = w[3] + sign * a[3];
      const l = Math.hypot(px, py, pz) || 1;
      p[i * 4] = px / l;
      p[i * 4 + 1] = py / l;
      p[i * 4 + 2] = pz / l;
      p[i * 4 + 3] = pw / l;
    };
    set(0, row(0), 1);
    set(1, row(0), -1);
    set(2, row(1), 1);
    set(3, row(1), -1);
    // reversed-Z infinite far: near plane is z<=w, "far" plane z>=0
    set(4, row(2), 1);
    set(5, row(2), -1);
    return p;
  }
}
