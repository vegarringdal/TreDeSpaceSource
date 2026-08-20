// Canvas-drawn view cube overlay (visuals only — the DOM ViewGizmo keeps
// hit-testing; drawn after post AND into pending snapshots). Owns the cube
// geometry, label atlas, pipelines and the AA offscreen pair; the renderer
// forwards placement/palette from the DOM gizmo and calls draw() per frame.
import type { GizmoFace } from '../overlay/ViewGizmo';
import type { GpuTimings } from './gpuTimings';
import { cubeBlitWgsl, viewCubeWgsl } from './shaders';
import { ATLAS_TILE, buildLabelAtlas, buildViewCubeGeometry, VIEWCUBE_REACH } from './viewCubeGpu';

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

  /** Everything that changes the cube's on-screen pixels, for the idle-skip key. */
  get stateKey(): string {
    return (
      `${this.rect ? `${this.rect.x},${this.rect.y},${this.rect.size}` : '-'};${this.hover};` +
      `${this.faceCol.join(',')};${this.lineCol.join(',')};${this.hoverCol.join(',')};${this.textCol}`
    );
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
    const E = S * VIEWCUBE_REACH;
    const vx = Math.max(0, Math.floor(cx - E));
    const vy = Math.max(0, Math.floor(cy - E));
    const vx1 = Math.min(canvas.width, Math.ceil(cx + E));
    const vy1 = Math.min(canvas.height, Math.ceil(cy + E));
    const vw = vx1 - vx;
    const vh = vy1 - vy;
    if (vw < 2 || vh < 2) {
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
        timestampWrites: timings.span(9, 'begin'),
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
        timestampWrites: timings.span(9, 'end'),
      });
      blit.setViewport(vx, vy, vw, vh, 0, 1);
      blit.setPipeline(this.blitPipeline!);
      blit.setBindGroup(0, this.blitBind!);
      blit.draw(3);
      blit.end();
      return;
    }

    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      timestampWrites: timings.writes(9),
    });
    pass.setViewport(vx, vy, vw, vh, 0, 1);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind!);
    pass.setVertexBuffer(0, this.verts);
    pass.draw(this.vertCount);
    pass.end();
  }
}
