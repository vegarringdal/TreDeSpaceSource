// Canvas-drawn view cube overlay (visuals only — the DOM ViewGizmo keeps
// hit-testing; drawn after post AND into pending snapshots). Owns the cube
// geometry, label atlas, pipelines and the AA offscreen pair; the renderer
// forwards placement/palette from the DOM gizmo and calls draw() per frame.
import type { GizmoFace } from '../overlay/ViewGizmo';
import {
  AXIS_REACH,
  basisFromQuat,
  layoutAxisGizmo,
  MARKER_REACH,
  type NavGizmoStyle,
  northMarkerPoint,
  northPointer,
  type SnapDotSet,
} from './axisGizmo';
import { type GizmoPalette, paintAxisGizmo, paintNorthMarker } from './axisGizmoPaint';
import type { GpuTimings } from './gpuTimings';
import { cubeBlitWgsl, viewCubeWgsl } from './shaders';
import { ATLAS_TILE, buildLabelAtlas, buildViewCubeGeometry, VIEWCUBE_REACH } from './viewCubeGpu';

/** What the navigation gizmo shows, from the settings (Settings → Gizmo). */
export type NavGizmoOptions = Readonly<{
  style: NavGizmoStyle;
  snapDots: SnapDotSet;
  /** The ball letters: the face names' first letters (faceLetters). */
  letters: Readonly<Record<GizmoFace, string>>;
  /** Degrees clockwise from +Y, seen from above. */
  northAngle: number;
  /** Draw the cube's true-north "N" marker (never on the balls). */
  northMarker: boolean;
}>;

/** Pixel location of the gizmo's mini viewport for one frame (device px). */
type GizmoBox = Readonly<{ vx: number; vy: number; vw: number; vh: number; cx: number; cy: number; S: number }>;

const DEFAULT_LETTERS: Readonly<Record<GizmoFace, string>> = {
  front: 'F',
  back: 'B',
  left: 'L',
  right: 'R',
  top: 'T',
  bottom: 'Bo',
};
/** The snap dots fade in/out over about this many ms. */
const REVEAL_FADE_MS = 90;
const REVEAL_DONE_EPS = 0.01;
/** The cube's north marker's hover key (its GizmoPick id). */
const NORTH_HOVER_KEY = 'north';
const NORTH_LABEL = 'N';

const toCss = (c: readonly [number, number, number]): string =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

export class ViewCubePass {
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private pipeline4x: GPURenderPipeline | null = null;
  private blitPipeline: GPURenderPipeline | null = null;
  private verts: GPUBuffer | null = null;
  private vertCount = 0;
  private uni: GPUBuffer | null = null;
  private bind: GPUBindGroup | null = null;
  private bind4x: GPUBindGroup | null = null;
  private atlas: GPUTexture | null = null;
  // AA offscreen pair (4× render + resolve), sized to the cube's mini-viewport
  private msaaTex: GPUTexture | null = null;
  private resolveTex: GPUTexture | null = null;
  private blitBind: GPUBindGroup | null = null;
  private labels: Partial<Record<GizmoFace, string>> = {};
  private atlasDirty = true;
  private rect: { x: number; y: number; size: number } | null = null; // CSS px stage box
  private hover = -1;
  private quat = { x: 0, y: 0, z: 0, w: 1 };
  private faceCol: [number, number, number] = [0.184, 0.212, 0.255]; // #2f3641
  private lineCol: [number, number, number] = [0.302, 0.337, 0.396]; // #4d5665
  private hoverCol: [number, number, number] = [0.29, 0.427, 0.612]; // #4a6d9c
  private textCol = '#c9cfd8';
  // navigation gizmo: style, axis balls and the cube's north marker. Both
  // are painted in 2D into `overlayCanvas` and blitted (see drawOverlay).
  private nav: NavGizmoOptions = {
    style: 'cube',
    snapDots: 'iso',
    letters: DEFAULT_LETTERS,
    northAngle: 0,
    northMarker: false,
  };
  private navHover = '';
  private revealTarget = 0;
  private reveal = 0;
  private revealT = 0;
  private overlayCanvas: OffscreenCanvas | null = null;
  private overlayTex: GPUTexture | null = null;
  private overlayBind: GPUBindGroup | null = null;
  private overlayKey = '';

  /** Create the static geometry, tiny uniform and pipelines. No depth — the
   *  cube is convex, per-fragment facing (not winding) culls the far plates. */
  init(dev: GPUDevice, format: GPUTextureFormat) {
    this.device = dev;
    const geo = buildViewCubeGeometry();
    this.vertCount = geo.vertexCount;
    this.verts = dev.createBuffer({
      label: 'cubeVerts',
      size: geo.vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(this.verts, 0, geo.vertexData);
    this.uni = dev.createBuffer({
      label: 'cubeUni',
      size: 160, // mat4 + params/viewer vec4s + face/bevel/line/hover color vec4s
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const cubeModule = dev.createShaderModule({ label: 'cubeModule', code: viewCubeWgsl() });
    const makeCubePipeline = (msaa: boolean) =>
      dev.createRenderPipeline({
        label: msaa ? 'cubePipeline4x' : 'cubePipeline',
        layout: 'auto',
        vertex: {
          module: cubeModule,
          entryPoint: 'vs',
          buffers: [
            {
              arrayStride: 48,
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x4' as const },
                { shaderLocation: 1, offset: 16, format: 'float32x4' as const },
                { shaderLocation: 2, offset: 32, format: 'float32x3' as const },
              ],
            },
          ],
        },
        fragment: {
          module: cubeModule,
          entryPoint: 'fs',
          targets: [
            {
              format,
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              },
            },
          ],
        },
        // no winding-based culling: the shader discards away-facing plates by
        // their normal (frame.viewer) — robust regardless of winding
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        ...(msaa ? { multisample: { count: 4 } } : {}),
      });
    this.pipeline = makeCubePipeline(false);
    // AA path: the cube renders into a 4× offscreen, resolves, and is
    // composited — matching the scene's AA instead of drawing raw edges
    this.pipeline4x = makeCubePipeline(true);
    const blitModule = dev.createShaderModule({ label: 'cubeBlitModule', code: cubeBlitWgsl() });
    this.blitPipeline = dev.createRenderPipeline({
      label: 'cubeBlitPipeline',
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs' },
      fragment: {
        module: blitModule,
        entryPoint: 'fs',
        targets: [
          {
            format,
            // premultiplied: the offscreen was resolved over transparent black
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  /** Position/hover/orientation for this frame. `rect` = the DOM gizmo's stage
   *  box in CSS px (null hides the cube); `q` = the camera quaternion. */
  setPlacement(rect: { x: number; y: number; size: number } | null, hover: number, q: typeof this.quat) {
    this.rect = rect;
    this.hover = hover;
    this.quat = q;
  }

  /** Change the cube's face labels (rebuilds the label atlas lazily). */
  setLabels(labels: Partial<Record<GizmoFace, string>>) {
    this.labels = labels;
    this.atlasDirty = true;
  }

  /** Cube palette (settings-driven; sketch mode passes its own set). The bevel
   *  plates take the face colour slightly lifted, like the original two-tone. */
  setColors(
    face: [number, number, number],
    line: [number, number, number],
    hover: [number, number, number],
    text: string,
  ) {
    this.faceCol = face;
    this.lineCol = line;
    this.hoverCol = hover;
    if (text !== this.textCol) {
      this.textCol = text;
      this.atlasDirty = true; // the text colour is baked into the atlas
    }
  }

  /** Style, letters, snap dots and north marker (settings-driven). */
  setNavOptions(options: NavGizmoOptions) {
    this.nav = options;
  }

  /** Per frame: the axis-ball item under the pointer ('' for none) and
   *  whether the snap dots should show; their fade runs in draw(). */
  setNavHover(hoverKey: string, isRevealed: boolean) {
    this.navHover = hoverKey;
    this.revealTarget = isRevealed ? 1 : 0;
  }

  /** The snap dots are mid-fade: the renderer keeps (hold) frames coming. */
  get isAnimating(): boolean {
    return (
      this.rect !== null && this.nav.style === 'balls' && Math.abs(this.reveal - this.revealTarget) > REVEAL_DONE_EPS
    );
  }

  /** Everything that changes the cube's on-screen pixels, for the idle-skip key.
   *  The dots' fade is left out on purpose (it would restart TAA every frame);
   *  isAnimating covers it. */
  get stateKey(): string {
    const n = this.nav;
    return (
      `${this.rect ? `${this.rect.x},${this.rect.y},${this.rect.size}` : '-'};${this.hover};` +
      `${this.faceCol.join(',')};${this.lineCol.join(',')};${this.hoverCol.join(',')};${this.textCol};` +
      `${n.style};${n.snapDots};${Object.values(n.letters).join(',')};${n.northAngle};${n.northMarker};` +
      `${this.navHover};${this.revealTarget}`
    );
  }

  /** Ease the snap dots' reveal toward its target (frame-rate independent). */
  private stepReveal() {
    const now = performance.now();
    const dt = this.revealT ? now - this.revealT : 0;
    this.revealT = now;
    const k = 1 - Math.exp(-dt / REVEAL_FADE_MS);
    this.reveal += (this.revealTarget - this.reveal) * k;
    if (Math.abs(this.reveal - this.revealTarget) <= REVEAL_DONE_EPS) {
      this.reveal = this.revealTarget;
    }
  }

  private palette(): GizmoPalette {
    return { face: toCss(this.faceCol), line: toCss(this.lineCol), text: this.textCol, hover: toCss(this.hoverCol) };
  }

  /** Paint the balls (or the cube's north marker) into the offscreen canvas,
   *  sized exactly to the mini viewport so the blit is 1:1 even when the
   *  viewport is clamped at the canvas edge. Repaints only on change. */
  private paintOverlay(dev: GPUDevice, box: GizmoBox): boolean {
    if (!this.blitPipeline) {
      return false;
    }
    const { vx, vy, vw, vh, cx, cy, S } = box;
    const q = this.quat;
    const n = this.nav;
    const key =
      `${vx},${vy},${vw},${vh},${S};${q.x},${q.y},${q.z},${q.w};${n.style};${n.snapDots};` +
      `${Object.values(n.letters).join(',')};${n.northAngle};${n.northMarker};${this.navHover};${this.reveal.toFixed(3)};` +
      `${this.faceCol.join(',')};${this.lineCol.join(',')};${this.hoverCol.join(',')};${this.textCol}`;
    if (!this.overlayTex || this.overlayTex.width !== vw || this.overlayTex.height !== vh) {
      this.overlayTex?.destroy();
      this.overlayTex = dev.createTexture({
        label: 'navGizmoOverlay',
        size: [vw, vh],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.overlayBind = dev.createBindGroup({
        label: 'navGizmoOverlayBind',
        layout: this.blitPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.overlayTex.createView() },
          { binding: 1, resource: dev.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
        ],
      });
      this.overlayKey = '';
    }
    if (key === this.overlayKey) {
      return true;
    }
    if (!this.overlayCanvas) {
      this.overlayCanvas = new OffscreenCanvas(vw, vh);
    }
    const canvas = this.overlayCanvas;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return false;
    }
    ctx.clearRect(0, 0, vw, vh);
    const basis = basisFromQuat(q);
    const ox = cx - vx;
    const oy = cy - vy;
    const palette = this.palette();
    if (n.style === 'balls') {
      const items = layoutAxisGizmo(basis, n.snapDots, this.reveal);
      paintAxisGizmo(ctx, items, { cx: ox, cy: oy, scale: S, letters: n.letters, hoverId: this.navHover, palette });
    } else if (n.northMarker) {
      const m = northMarkerPoint(basis, n.northAngle);
      const pointer = northPointer(basis, n.northAngle).map((p) => ({ x: ox + p.x * S, y: oy + p.y * S }));
      paintNorthMarker(ctx, {
        x: ox + m.x * S,
        y: oy + m.y * S,
        scale: S,
        label: NORTH_LABEL,
        pointer,
        isBehind: m.depth < 0,
        isHover: this.navHover === NORTH_HOVER_KEY,
        palette,
      });
    }
    // premultiplied: the blit blends one / one-minus-src-alpha
    dev.queue.copyExternalImageToTexture({ source: canvas }, { texture: this.overlayTex, premultipliedAlpha: true }, [
      vw,
      vh,
    ]);
    this.overlayKey = key;
    return true;
  }

  /** Blit the painted overlay onto the frame at the mini viewport. */
  private drawOverlay(
    enc: GPUCommandEncoder,
    view: GPUTextureView,
    box: GizmoBox,
    timestampWrites: GPURenderPassTimestampWrites | undefined,
  ) {
    const dev = this.device;
    if (!dev || !this.blitPipeline || !this.paintOverlay(dev, box) || !this.overlayBind) {
      return;
    }
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      ...(timestampWrites ? { timestampWrites } : {}),
    });
    pass.setViewport(box.vx, box.vy, box.vw, box.vh, 0, 1);
    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, this.overlayBind);
    pass.draw(3);
    pass.end();
  }

  /** Overlay pass: draw the view cube into `view` (the swapchain after post,
   *  and the snapshot source when a capture is pending). `dpr` must include
   *  any hi-res capture scale; `wantAA` = MSAA or TAA is on for the scene. */
  draw(
    enc: GPUCommandEncoder,
    view: GPUTextureView,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
    dpr: number,
    wantAA: boolean,
    timings: GpuTimings,
  ) {
    const rect = this.rect;
    const dev = this.device;
    if (!rect || !dev || !this.pipeline || !this.verts || !this.uni) {
      return;
    }
    if (this.atlasDirty) {
      this.atlasDirty = false;
      const atlasCanvas = buildLabelAtlas(this.labels, this.textCol);
      if (!this.atlas) {
        this.atlas = dev.createTexture({
          label: 'cubeAtlas',
          size: [ATLAS_TILE * 6, ATLAS_TILE],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
      }
      dev.queue.copyExternalImageToTexture({ source: atlasCanvas }, { texture: this.atlas }, [
        ATLAS_TILE * 6,
        ATLAS_TILE,
      ]);
      // 'auto' layouts are per-pipeline: the 1× and 4× pipelines each need
      // their own bind group over the same resources
      const entries = [
        { binding: 0, resource: { buffer: this.uni } },
        { binding: 1, resource: this.atlas.createView() },
        { binding: 2, resource: dev.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
      ];
      this.bind = dev.createBindGroup({
        label: 'cubeBind',
        layout: this.pipeline.getBindGroupLayout(0),
        entries,
      });
      this.bind4x = dev.createBindGroup({
        label: 'cubeBind4x',
        layout: this.pipeline4x!.getBindGroupLayout(0),
        entries,
      });
    }
    // The mini-viewport is the stage box expanded by VIEWCUBE_REACH so a
    // rotated cube is never clipped; the ortho scale compensates, keeping
    // 1 cube edge = rect.size px — exactly the DOM plates' projection.
    // dpr includes captureScale: a hi-res snapshot renders at dpr×captureScale,
    // and the cube must scale with it or it lands small and misplaced.
    const S = rect.size * dpr;
    const cx = (rect.x + rect.size / 2) * dpr;
    const cy = (rect.y + rect.size / 2) * dpr;
    // the balls and the cube's north marker reach further than the cube
    const isBalls = this.nav.style === 'balls';
    const reach = isBalls ? AXIS_REACH : this.nav.northMarker ? MARKER_REACH : VIEWCUBE_REACH;
    const E = S * reach;
    const vx = Math.max(0, Math.floor(cx - E));
    const vy = Math.max(0, Math.floor(cy - E));
    const vx1 = Math.min(canvas.width, Math.ceil(cx + E));
    const vy1 = Math.min(canvas.height, Math.ceil(cy + E));
    const vw = vx1 - vx;
    const vh = vy1 - vy;
    if (vw < 2 || vh < 2) {
      return;
    }
    const box: GizmoBox = { vx, vy, vw, vh, cx, cy, S };
    this.stepReveal();
    if (isBalls) {
      this.drawOverlay(enc, view, box, timings.writes(10));
      return;
    }
    // Same rotation the DOM gizmo shows. CSS matrix3d is COLUMN-major, so
    // ViewGizmo.update sets T = D·R(q)ᵀ·D over css-authored coords; with
    // authored = D·world that collapses to screen = D·Rᵀ·world:
    //   x'          =  col0(R)·w
    //   y' (css ↓)  = -col1(R)·w   → ndc.y = +col1(R)·w
    //   toward-viewer = col2(R)·w
    const { x, y, z, w } = this.quat;
    const m00 = 1 - 2 * (y * y + z * z);
    const m01 = 2 * (x * y - z * w);
    const m02 = 2 * (x * z + y * w);
    const m10 = 2 * (x * y + z * w);
    const m11 = 1 - 2 * (x * x + z * z);
    const m12 = 2 * (y * z - x * w);
    const m20 = 2 * (x * z - y * w);
    const m21 = 2 * (y * z + x * w);
    const m22 = 1 - 2 * (x * x + y * y);
    const fx = (2 * S) / vw;
    const fy = (2 * S) / vh;
    const ox = (2 * (cx - vx)) / vw - 1;
    const oy = 1 - (2 * (cy - vy)) / vh;
    const uni = new Float32Array(40);
    // column-major mat4: ndc = (fx·col0(R) + ox, fy·col1(R) + oy, 0.5)
    uni[0] = fx * m00;
    uni[4] = fx * m10;
    uni[8] = fx * m20;
    uni[12] = ox;
    uni[1] = fy * m01;
    uni[5] = fy * m11;
    uni[9] = fy * m21;
    uni[13] = oy;
    uni[14] = 0.5;
    uni[15] = 1;
    uni[16] = this.hover;
    uni[17] = 1; // opacity
    // toward-viewer direction in world space = col2(R)
    uni[20] = m02;
    uni[21] = m12;
    uni[22] = m22;
    // palette: face, bevel (face lifted ~8%, matching the old two-tone), line
    const [fr, fg, fb] = this.faceCol;
    uni.set([fr, fg, fb, 1], 24);
    uni.set([Math.min(1, fr * 1.08 + 0.016), Math.min(1, fg * 1.08 + 0.016), Math.min(1, fb * 1.08 + 0.016), 1], 28);
    uni.set([...this.lineCol, 1], 32);
    uni.set([...this.hoverCol, 1], 36);
    dev.queue.writeBuffer(this.uni, 0, uni);

    // AA path (MSAA or TAA on): render into a 2× supersampled 4× MSAA
    // offscreen, resolve, and composite with a linear downsample. The overlay
    // draws after post, so it can't ride the scene's AA; MSAA alone only
    // smooths triangle edges, the 2× supersample also covers the fragment-
    // computed border lines and the label text.
    const SS = 2;
    if (wantAA && this.pipeline4x && this.blitPipeline) {
      if (!this.msaaTex || this.msaaTex.width !== vw * SS || this.msaaTex.height !== vh * SS) {
        this.msaaTex?.destroy();
        this.resolveTex?.destroy();
        this.msaaTex = dev.createTexture({
          label: 'cubeMsaa',
          size: [vw * SS, vh * SS],
          sampleCount: 4,
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.resolveTex = dev.createTexture({
          label: 'cubeResolve',
          size: [vw * SS, vh * SS],
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.blitBind = dev.createBindGroup({
          label: 'cubeBlitBind',
          layout: this.blitPipeline!.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.resolveTex.createView() },
            { binding: 1, resource: dev.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
          ],
        });
      }
      const cube = enc.beginRenderPass({
        timestampWrites: timings.span(10, 'begin'),
        colorAttachments: [
          {
            view: this.msaaTex.createView(),
            resolveTarget: this.resolveTex!.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'discard',
          },
        ],
      });
      cube.setPipeline(this.pipeline4x!);
      cube.setBindGroup(0, this.bind4x!);
      cube.setVertexBuffer(0, this.verts);
      cube.draw(this.vertCount);
      cube.end();

      const blit = enc.beginRenderPass({
        colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
        timestampWrites: timings.span(10, 'end'),
      });
      blit.setViewport(vx, vy, vw, vh, 0, 1);
      blit.setPipeline(this.blitPipeline!);
      blit.setBindGroup(0, this.blitBind!);
      blit.draw(3);
      blit.end();
      if (this.nav.northMarker) {
        this.drawOverlay(enc, view, box, undefined);
      }
      return;
    }

    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      timestampWrites: timings.writes(10),
    });
    pass.setViewport(vx, vy, vw, vh, 0, 1);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind!);
    pass.setVertexBuffer(0, this.verts);
    pass.draw(this.vertCount);
    pass.end();
    if (this.nav.northMarker) {
      this.drawOverlay(enc, view, box, undefined);
    }
  }
}
