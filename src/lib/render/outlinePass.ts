// Outline effect (three.js OutlinePass port on the native hover_xray mask):
// outline draw list (compute) -> subset depth mask -> edge classify
// (visible/hidden vs scene depth) -> separable blur (+ optional half-res
// glow) -> additive composite onto the finished frame. Owns its pipelines,
// uniform buffers and lazy canvas-sized targets; the renderer calls encode()
// only when something is outlined.
//
// The draw list is what keeps the mask cheap: a per-model compute filter
// (outlineListWgsl) emits only the outlined items' visible meshlets into the
// model's outline record slot, and the mask replays that list alone. Replaying
// the whole scene and discarding per fragment cost a large slice of the scene
// pass on every frame with anything selected.
//
// Temporal accumulation: the mask replays the scene with the frame's TAA
// jitter, so a single frame's outline sits wherever that frame's sub-pixel
// offset put it — composited straight onto the stable TAA average it would
// hop around for the whole convergence. The edge classify therefore blends
// into a history texture with the scene's running-average weight
// (1/(accumIdx+1), 1 = overwrite), so the outline converges to the same
// anti-aliased average as the scene. A converged hold frame re-composites the
// last blurred result and encodes nothing else.

import { FRAME_SIZE, FRAME_SLOT } from './frameLayout';
import { type GpuModel, OUTLINE_LIST, replayDrawLists } from './gpuModel';
import type { GpuTimings } from './gpuTimings';
import { outlineWgsl } from './shaders';
import { outlineListWgsl } from './shaders/cull';

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

/** A model's buffers the outline list build reads and writes (renderer
 *  buildModelResources → createListBind). */
export interface OutlineListBuffers {
  meshletCull: GPUBuffer;
  records: GPUBuffer;
  counts: GPUBuffer;
  countOffset: number;
  vis: GPUBuffer;
  meshletInfo: GPUBuffer;
  itemState: GPUBuffer;
  modelUni: GPUBuffer;
}

/** Bytes of a model's outline count slot the list build binds: the vertex-pull
 *  drawIndirect args block (the MDI count is its first word). */
const LIST_ARGS_BYTES = 16;

export class OutlinePass {
  private listPipeline!: GPUComputePipeline; // MDI records
  private listVpPipeline!: GPUComputePipeline; // vertex-pull list
  private listBGL!: GPUBindGroupLayout;
  private listParamsBuf!: GPUBuffer;
  private listParamsBind!: GPUBindGroup;
  private maskPipeline!: GPURenderPipeline;
  private maskVpPipeline!: GPURenderPipeline;
  private edgePipeline!: GPURenderPipeline; // 1-sample scene depth
  private edgeMsPipeline!: GPURenderPipeline; // 4-sample scene depth
  private blurPipeline!: GPURenderPipeline;
  private compPipeline!: GPURenderPipeline;
  // lazy canvas-sized targets: mask depth, edge/blur ping-pong, half-res glow
  // pair — all tiny rg8unorm except the depth mask
  private depthTex: GPUTexture | null = null;
  private histTex: GPUTexture | null = null; // accumulated raw edge classify
  private edgeTex: GPUTexture | null = null; // blurred history (composite input)
  private tmpTex: GPUTexture | null = null;
  // history validity: dropped when the targets are rebuilt, the outlined set
  // changes (hover id) or the renderer skipped the outline for a frame
  private histValid = false;
  private histHoverId = 0;
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
    // outline draw list build: explicit layouts, so one per-model bind group
    // serves both emit variants (their binding 1/2 differ only in shape)
    const compute = GPUShaderStage.COMPUTE;
    const storage = (binding: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: compute,
      buffer: { type },
    });
    this.listBGL = dev.createBindGroupLayout({
      label: 'outlineListBGL',
      entries: [
        storage(0, 'read-only-storage'),
        storage(1, 'storage'),
        storage(2, 'storage'),
        storage(3, 'read-only-storage'),
        storage(4, 'read-only-storage'),
        storage(5, 'read-only-storage'),
        storage(6, 'uniform'),
      ],
    });
    const listParamsBGL = dev.createBindGroupLayout({
      label: 'outlineListParamsBGL',
      entries: [storage(0, 'uniform')],
    });
    const listLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.listBGL, listParamsBGL] });
    const mkList = (vp: boolean) =>
      dev.createComputePipeline({
        label: 'outlineListPipeline',
        layout: listLayout,
        compute: { module: dev.createShaderModule({ label: 'outlineListModule', code: outlineListWgsl(vp) }) },
      });
    this.listPipeline = mkList(false);
    this.listVpPipeline = mkList(true);
    this.listParamsBuf = dev.createBuffer({
      label: 'outlineListParamsBuf',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.listParamsBind = dev.createBindGroup({
      label: 'outlineListParamsBind',
      layout: listParamsBGL,
      entries: [{ binding: 0, resource: { buffer: this.listParamsBuf } }],
    });

    // subset depth mask: replay of the outline list through the scene
    // geometry path, fs_outline applying the clip; depth-only against its OWN
    // cleared target
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
    // edge classify blends into the history with the blend CONSTANT as the
    // running-average weight (setBlendConstant per frame; 1 overwrites)
    const accumulate: GPUBlendComponent = { srcFactor: 'constant', dstFactor: 'one-minus-constant' };
    const mkEdge = (m: GPUShaderModule) =>
      dev.createRenderPipeline({
        label: 'outlineEdgePipeline',
        layout: 'auto',
        vertex: { module: m, entryPoint: 'vs' },
        fragment: {
          module: m,
          entryPoint: 'fs_edge',
          targets: [{ format: 'rg8unorm', blend: { color: accumulate, alpha: accumulate } }],
        },
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

  /** The per-model bind group of the outline list build (buildModelResources). */
  createListBind(dev: GPUDevice, b: OutlineListBuffers): GPUBindGroup {
    return dev.createBindGroup({
      label: 'outlineListBind',
      layout: this.listBGL,
      entries: [
        { binding: 0, resource: { buffer: b.meshletCull } },
        { binding: 1, resource: { buffer: b.records } },
        { binding: 2, resource: { buffer: b.counts, offset: b.countOffset, size: LIST_ARGS_BYTES } },
        { binding: 3, resource: { buffer: b.vis } },
        { binding: 4, resource: { buffer: b.meshletInfo } },
        { binding: 5, resource: { buffer: b.itemState } },
        { binding: 6, resource: { buffer: b.modelUni } },
      ],
    });
  }

  /** Forget the accumulated outline — the next encode overwrites it. The
   *  renderer calls this on frames that draw no outline, so a stale average
   *  is never blended into a later one. */
  dropHistory() {
    this.histValid = false;
  }

  /** Encode the whole outline chain onto the finished frame.
   *  `accumIdx` is the scene's TAA sample index (0 = restart) and `hold` the
   *  renderer's converged-hold path: the history is then re-composited as is. */
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
    accumIdx: number,
    hold: boolean,
    timings: GpuTimings,
  ) {
    // lazy canvas-sized targets: mask depth + edge/blur ping-pong (+ half-res glow)
    const w = canvas.width;
    const h = canvas.height;
    if (!this.depthTex || this.depthTex.width !== w || this.depthTex.height !== h) {
      for (const t of [this.depthTex, this.histTex, this.edgeTex, this.tmpTex, this.glowA, this.glowB]) {
        t?.destroy();
      }
      this.histValid = false;
      const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
      const mkRg = (tw: number, th: number) =>
        dev.createTexture({ label: 'outlineRgTex', size: [tw, th], format: 'rg8unorm', usage });
      this.depthTex = dev.createTexture({
        label: 'outlineDepthTex',
        size: [w, h],
        format: 'depth32float',
        usage,
      });
      this.histTex = mkRg(w, h);
      this.edgeTex = mkRg(w, h);
      this.tmpTex = mkRg(w, h);
      this.glowA = mkRg(Math.max(1, w >> 1), Math.max(1, h >> 1));
      this.glowB = mkRg(Math.max(1, w >> 1), Math.max(1, h >> 1));
    }

    // restart the average when the scene's did, when the outlined set changed
    // under a converged scene (hover) or when the history is stale; a hold
    // frame with a valid history only re-composites the last blurred result
    const restart = !this.histValid || accumIdx === 0 || hoverId !== this.histHoverId;
    const weight = restart ? 1 : 1 / (accumIdx + 1);
    this.histValid = true;
    this.histHoverId = hoverId;

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

    const fullscreen = (
      pipeline: GPURenderPipeline,
      view: GPUTextureView,
      entries: GPUBindGroupEntry[],
      load: GPULoadOp = 'clear',
      timestampWrites?: GPURenderPassTimestampWrites,
      blendConstant?: number,
    ) => {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view, loadOp: load, storeOp: 'store' }],
        timestampWrites,
      });
      pass.setPipeline(pipeline);
      if (blendConstant !== undefined) {
        pass.setBlendConstant({ r: blendConstant, g: blendConstant, b: blendConstant, a: blendConstant });
      }
      pass.setBindGroup(
        0,
        dev.createBindGroup({ label: 'outlineFullscreenBind', layout: pipeline.getBindGroupLayout(0), entries }),
      );
      pass.draw(3);
      pass.end();
    };
    const compositeEntries: GPUBindGroupEntry[] = [
      { binding: 4, resource: this.edgeTex!.createView() },
      { binding: 5, resource: this.glowB!.createView() },
      { binding: 6, resource: { buffer: this.compBuf } },
    ];
    if (hold && !restart) {
      const begin = timings.span(9, 'begin');
      const end = timings.span(9, 'end');
      fullscreen(
        this.compPipeline,
        swapView,
        compositeEntries,
        'load',
        begin && end ? { ...begin, ...end } : undefined,
      );
      return;
    }

    // outline frame slot @768: blend routing off (every outlined item in one
    // replay); ambient.x = include-selected flag, ambient.y = hover id (bitcast)
    const includeSelected = opt.outlineSelection && opt.outlineSelectionActive;
    const of = new ArrayBuffer(FRAME_SIZE);
    new Uint8Array(of).set(new Uint8Array(frameData));
    const ou = new Uint32Array(of);
    ou[FRAME_SLOT.flags + 2] = 0;
    const ofl = new Float32Array(of);
    ofl[FRAME_SLOT.ambient] = includeSelected ? 1 : 0;
    ou[FRAME_SLOT.ambient + 1] = hoverId;
    dev.queue.writeBuffer(frameBuf, 768, of);
    // the no-cull full draw keeps no visibility words: the list takes every
    // meshlet of an outlined item, and the mask draws it through the
    // vertex-pull path like the full draw itself
    const listVis = cullMode !== 'full';
    const maskMode = cullMode === 'full' ? 'vp' : cullMode;
    dev.queue.writeBuffer(
      this.listParamsBuf,
      0,
      new Uint32Array([hoverId, includeSelected ? 1 : 0, listVis ? 1 : 0, 0]),
    );

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

    // 1 — outline draw list: per model, the outlined items' meshlets among
    // what the cull left visible, into the model's outline record slot
    const live = models.filter((m) => !m.dead && m.meshletCount > 0);
    for (const m of live) {
      enc.clearBuffer(countsBuf, m.countOffsetO, LIST_ARGS_BYTES);
    }
    const list = enc.beginComputePass({ timestampWrites: timings.span(9, 'begin') });
    list.setPipeline(maskMode === 'mdi' ? this.listPipeline : this.listVpPipeline);
    list.setBindGroup(1, this.listParamsBind);
    for (const m of live) {
      list.setBindGroup(0, m.outlineListBind);
      list.dispatchWorkgroups(Math.ceil(m.meshletCount / 64));
    }
    list.end();

    // 2 — subset depth mask: replay that list depth-only through fs_outline
    // (the clip discard); no scene depth test, so occluded parts of the
    // subset still land in the mask (native hover_xray)
    const mask = enc.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.depthTex!.createView(),
        depthClearValue: 0, // reversed-Z
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    replayDrawLists(mask, models, countsBuf, maskMode, this.maskPipeline, this.maskVpPipeline, 768, [OUTLINE_LIST]);
    mask.end();

    // 3 — fullscreen chain: edge classify accumulates into the history (a
    // weight of 1 overwrites it, so it never needs clearing); the blurs read
    // the history and land in edgeTex, the composite's input.
    const edgePipe = opt.msaa4x ? this.edgeMsPipeline : this.edgePipeline;
    fullscreen(
      edgePipe,
      this.histTex!.createView(),
      [
        { binding: 0, resource: this.depthTex!.createView() },
        { binding: 1, resource: sceneDepth.createView() },
      ],
      'load',
      undefined,
      weight,
    );
    if (glowOn) {
      fullscreen(this.blurPipeline, this.glowA!.createView(), [
        { binding: 2, resource: this.histTex!.createView() },
        { binding: 3, resource: { buffer: this.glowHBuf } },
      ]);
    }
    fullscreen(this.blurPipeline, this.tmpTex!.createView(), [
      { binding: 2, resource: this.histTex!.createView() },
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
    // 4 — additive composite over the finished frame (glow contribution is
    // zeroed by the uniform when off, so stale glow texels are harmless)
    fullscreen(this.compPipeline, swapView, compositeEntries, 'load', timings.span(9, 'end'));
  }
}
