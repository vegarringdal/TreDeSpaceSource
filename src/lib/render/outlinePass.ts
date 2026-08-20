// Outline effect (three.js OutlinePass port on the native hover_xray mask):
// subset depth mask -> edge classify (visible/hidden vs scene depth) ->
// separable blur (+ optional half-res glow) -> additive composite onto the
// finished frame. Owns its pipelines, uniform buffers and lazy canvas-sized
// targets; the renderer calls encode() only when something is outlined.

import { type GpuModel, replayDrawLists } from './gpuModel';
import type { GpuTimings } from './gpuTimings';
import { outlineWgsl } from './shaders';

/** The `options` fields the outline pass reads. */
interface OutlineOptions {
  msaa4x: boolean;
  outlineSelection: boolean;
  outlineSelectionActive: boolean;
  outlineThickness: number;
  outlineGlow: number;
  outlinePulse: number;
  outlineStrength: number;
  outlineVisibleColor: [number, number, number];
  outlineHiddenColor: [number, number, number];
}

export class OutlinePass {
  private maskPipeline!: GPURenderPipeline;
  private maskVpPipeline!: GPURenderPipeline;
  private edgePipeline!: GPURenderPipeline; // 1-sample scene depth
  private edgeMsPipeline!: GPURenderPipeline; // 4-sample scene depth
  private blurPipeline!: GPURenderPipeline;
  private compPipeline!: GPURenderPipeline;
  // lazy canvas-sized targets: mask depth, edge/blur ping-pong, half-res glow
  // pair — all tiny rg8unorm except the depth mask
  private depthTex: GPUTexture | null = null;
  private edgeTex: GPUTexture | null = null;
  private tmpTex: GPUTexture | null = null;
  private glowA: GPUTexture | null = null;
  private glowB: GPUTexture | null = null;
  private blurH!: GPUBuffer; // BlurParams per direction/scale
  private blurV!: GPUBuffer;
  private glowHBuf!: GPUBuffer;
  private glowVBuf!: GPUBuffer;
  private compBuf!: GPUBuffer; // CompositeParams

  /** Build the mask (scene replay, depth-only) + fullscreen-chain pipelines.
   *  The mask pipelines share the scene's pipeline layouts/modules so the
   *  fs_outline discard sees the same bindings as the real render. */
  init(
    dev: GPUDevice,
    format: GPUTextureFormat,
    renderLayout: GPUPipelineLayout,
    renderModule: GPUShaderModule,
    vpLayout: GPUPipelineLayout,
    vpModule: GPUShaderModule,
  ) {
    // subset depth mask: scene geometry replay, fs_outline discards everything
    // that isn't outlined; depth-only against its OWN cleared target
    const outlineDepthOnly = {
      primitive: { topology: 'triangle-list' as const, cullMode: 'none' as const },
      depthStencil: {
        format: 'depth32float' as const,
        depthWriteEnabled: true,
        depthCompare: 'greater' as const, // reversed-Z, same as the scene
      },
    };
    this.maskPipeline = dev.createRenderPipeline({
      label: 'outlineMaskPipeline',
      layout: renderLayout,
      vertex: {
        module: renderModule,
        entryPoint: 'vs',
        buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'uint16x4' as const }] }],
      },
      fragment: { module: renderModule, entryPoint: 'fs_outline', targets: [] },
      ...outlineDepthOnly,
    });
    this.maskVpPipeline = dev.createRenderPipeline({
      label: 'outlineMaskVpPipeline',
      layout: vpLayout,
      vertex: { module: vpModule, entryPoint: 'vs' },
      fragment: { module: vpModule, entryPoint: 'fs_outline', targets: [] },
      ...outlineDepthOnly,
    });
    // fullscreen resolve chain: edge classify -> separable blur -> composite
    const mkOutline = (msaa: boolean) => dev.createShaderModule({ label: 'outlineModule', code: outlineWgsl(msaa) });
    const outlineModule = mkOutline(false);
    const outlineMsModule = mkOutline(true);
    const mkEdge = (m: GPUShaderModule) =>
      dev.createRenderPipeline({
        label: 'outlineEdgePipeline',
        layout: 'auto',
        vertex: { module: m, entryPoint: 'vs' },
        fragment: { module: m, entryPoint: 'fs_edge', targets: [{ format: 'rg8unorm' }] },
        primitive: { topology: 'triangle-list' },
      });
    this.edgePipeline = mkEdge(outlineModule);
    this.edgeMsPipeline = mkEdge(outlineMsModule);
    this.blurPipeline = dev.createRenderPipeline({
      label: 'outlineBlurPipeline',
      layout: 'auto',
      vertex: { module: outlineModule, entryPoint: 'vs' },
      fragment: { module: outlineModule, entryPoint: 'fs_blur', targets: [{ format: 'rg8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.compPipeline = dev.createRenderPipeline({
      label: 'outlineCompPipeline',
      layout: 'auto',
      vertex: { module: outlineModule, entryPoint: 'vs' },
      fragment: {
        module: outlineModule,
        entryPoint: 'fs_composite',
        // additive over the finished frame, like the three.js overlay material
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one' },
              alpha: { srcFactor: 'zero', dstFactor: 'one' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });
    const mkBlurBuf = () =>
      dev.createBuffer({ label: 'outlineBlurBuf', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blurH = mkBlurBuf();
    this.blurV = mkBlurBuf();
    this.glowHBuf = mkBlurBuf();
    this.glowVBuf = mkBlurBuf();
    this.compBuf = dev.createBuffer({
      label: 'outlineCompBuf',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /** Encode the whole outline chain onto the finished frame. */
  encode(
    enc: GPUCommandEncoder,
    dev: GPUDevice,
    canvas: HTMLCanvasElement,
    opt: OutlineOptions,
    cullMode: 'mdi' | 'vp' | 'full',
    frameData: ArrayBuffer,
    frameBuf: GPUBuffer,
    countsBuf: GPUBuffer,
    models: GpuModel[],
    sceneDepth: GPUTexture,
    swapView: GPUTextureView,
    hoverId: number,
    timings: GpuTimings,
  ) {
    // lazy canvas-sized targets: mask depth + edge/blur ping-pong (+ half-res glow)
    const w = canvas.width;
    const h = canvas.height;
    if (!this.depthTex || this.depthTex.width !== w || this.depthTex.height !== h) {
      for (const t of [this.depthTex, this.edgeTex, this.tmpTex, this.glowA, this.glowB]) {
        t?.destroy();
      }
      const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
      const mkRg = (tw: number, th: number) =>
        dev.createTexture({ label: 'outlineRgTex', size: [tw, th], format: 'rg8unorm', usage });
      this.depthTex = dev.createTexture({
        label: 'outlineDepthTex',
        size: [w, h],
        format: 'depth32float',
        usage,
      });
      this.edgeTex = mkRg(w, h);
      this.tmpTex = mkRg(w, h);
      this.glowA = mkRg(Math.max(1, w >> 1), Math.max(1, h >> 1));
      this.glowB = mkRg(Math.max(1, w >> 1), Math.max(1, h >> 1));
    }

    // outline frame slot @768: blend routing off (every outlined item in one
    // replay); ambient.x = include-selected flag, ambient.y = hover id (bitcast)
    const of = new ArrayBuffer(160);
    new Uint8Array(of).set(new Uint8Array(frameData));
    const ou = new Uint32Array(of);
    ou[22] = 0;
    const ofl = new Float32Array(of);
    ofl[28] = opt.outlineSelection && opt.outlineSelectionActive ? 1 : 0;
    ou[29] = hoverId;
    dev.queue.writeBuffer(frameBuf, 768, of);

    // blur params: thickness-radius full-res pair + fixed-wide half-res glow pair
    const thickness = Math.max(1, Math.min(4, opt.outlineThickness));
    const writeBlur = (buf: GPUBuffer, dx: number, dy: number, radius: number, srcScale = 1) =>
      dev.queue.writeBuffer(buf, 0, new Float32Array([dx, dy, radius, srcScale]));
    writeBlur(this.blurH, 1, 0, thickness);
    writeBlur(this.blurV, 0, 1, thickness);
    const glowOn = opt.outlineGlow > 0;
    if (glowOn) {
      // glow H reads the FULL-RES edge texture into the half-res target —
      // srcScale 2 maps destination pixels back onto the right source pixels
      writeBlur(this.glowHBuf, 1, 0, 4, 2);
      writeBlur(this.glowVBuf, 0, 1, 4);
    }
    // pulse: the three.js oscillation, applied CPU-side to the strength
    const pulse =
      opt.outlinePulse > 0
        ? 0.625 + 0.375 * Math.cos(((performance.now() / 1000) * 2 * Math.PI) / opt.outlinePulse)
        : 1;
    dev.queue.writeBuffer(
      this.compBuf,
      0,
      new Float32Array([
        ...opt.outlineVisibleColor,
        opt.outlineStrength * pulse,
        ...opt.outlineHiddenColor,
        opt.outlineGlow,
      ]),
    );

    // 1 — subset depth mask: replay the scene draw lists depth-only through
    // fs_outline (discards everything not outlined); no scene depth test, so
    // occluded parts of the subset still land in the mask (native hover_xray)
    const mask = enc.beginRenderPass({
      colorAttachments: [],
      timestampWrites: timings.span(8, 'begin'),
      depthStencilAttachment: {
        view: this.depthTex!.createView(),
        depthClearValue: 0, // reversed-Z
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    replayDrawLists(mask, models, countsBuf, cullMode, this.maskPipeline, this.maskVpPipeline, 768);
    mask.end();

    // 2 — fullscreen chain. Order matters: glow-H reads the RAW edge texture,
    // so it runs before blur-V overwrites it.
    const fullscreen = (
      pipeline: GPURenderPipeline,
      view: GPUTextureView,
      entries: GPUBindGroupEntry[],
      load: GPULoadOp = 'clear',
      timestampWrites?: GPURenderPassTimestampWrites,
    ) => {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view, loadOp: load, storeOp: 'store' }],
        timestampWrites,
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        dev.createBindGroup({ label: 'outlineFullscreenBind', layout: pipeline.getBindGroupLayout(0), entries }),
      );
      pass.draw(3);
      pass.end();
    };
    const edgePipe = opt.msaa4x ? this.edgeMsPipeline : this.edgePipeline;
    fullscreen(edgePipe, this.edgeTex!.createView(), [
      { binding: 0, resource: this.depthTex!.createView() },
      { binding: 1, resource: sceneDepth.createView() },
    ]);
    if (glowOn) {
      fullscreen(this.blurPipeline, this.glowA!.createView(), [
        { binding: 2, resource: this.edgeTex!.createView() },
        { binding: 3, resource: { buffer: this.glowHBuf } },
      ]);
    }
    fullscreen(this.blurPipeline, this.tmpTex!.createView(), [
      { binding: 2, resource: this.edgeTex!.createView() },
      { binding: 3, resource: { buffer: this.blurH } },
    ]);
    fullscreen(this.blurPipeline, this.edgeTex!.createView(), [
      { binding: 2, resource: this.tmpTex!.createView() },
      { binding: 3, resource: { buffer: this.blurV } },
    ]);
    if (glowOn) {
      fullscreen(this.blurPipeline, this.glowB!.createView(), [
        { binding: 2, resource: this.glowA!.createView() },
        { binding: 3, resource: { buffer: this.glowVBuf } },
      ]);
    }
    // 3 — additive composite over the finished frame (glow contribution is
    // zeroed by the uniform when off, so stale glow texels are harmless)
    fullscreen(
      this.compPipeline,
      swapView,
      [
        { binding: 4, resource: this.edgeTex!.createView() },
        { binding: 5, resource: this.glowB!.createView() },
        { binding: 6, resource: { buffer: this.compBuf } },
      ],
      'load',
      timings.span(8, 'end'),
    );
  }
}
