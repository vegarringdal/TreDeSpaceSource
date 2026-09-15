// Click item-picking. Two paths, same answer:
//
//   fast  — nothing in the scene is transparent, so every item is opaque and
//           the opacity rule below is a no-op (both its branches return solid
//           for opacity 1.0, at any threshold, shift or not). The main pass
//           already wrote the packed item id into the G-buffer id target, so
//           one compute workgroup reads that texel and we are done: no
//           geometry, no extra targets. This is the overwhelmingly common
//           case, and it keeps a click as cheap as any other frame.
//   replay — something IS transparent, so the pick rule and the displayed
//           image genuinely disagree (blend mode masks id writes off for
//           transparent items; alpha hash writes them stochastically). The
//           scene draw lists replay through pick pipelines whose fragment
//           discards items on the wrong side of the opacity threshold, one
//           cursor texel is copied out, and the packed global id resolves the
//           caller's promise (native mesh_pick port). Owns its 1-sample
//           targets — the main G-buffer is 4-sample under MSAA (not copyable,
//           and the 1-sample pick pipelines couldn't render into it) — and
//           allocates them lazily, so a scene that never goes transparent
//           never pays for them.

import { FRAME_SIZE, FRAME_SLOT } from './frameLayout';
import { type GpuModel, replayDrawLists } from './gpuModel';
import type { GpuTimings } from './gpuTimings';
import { pickItemIdWgsl } from './shaders';

/** The `options` fields the pick pass reads. */
interface PickOptions {
  /** items at/above this opacity % are clickable and block clicks; below it
   *  clicks pass through. Shift inverts the band. */
  pickOpacityPct: number;
  /** Any baked-transparent color group or opacity/color-alpha override in the
   *  scene. False = every item is opaque and the fast path is exact. */
  hasTransparency: boolean;
}

/** A queued pick: device pixel, modifier, and the caller's resolver. */
interface PickRequest {
  x: number;
  y: number;
  shift: boolean;
  resolve: (id: number | null) => void;
}

/** The G-buffer targets the fast path reads. */
export interface PickGbuffer {
  /** rgba8unorm id target the main pass writes (`FsOut.id`). */
  id: GPUTexture;
  /** Scene depth, used only under MSAA to choose the nearest sample. */
  depth: GPUTexture;
  msaa: boolean;
}

export class ItemPickPass {
  private itemPickBuf: GPUBuffer | null = null;
  private pickIdTex: GPUTexture | null = null;
  private pickDepthTex: GPUTexture | null = null;
  private pending: PickRequest | null = null;
  // one item-pick readback at a time: itemPickBuf is a single shared buffer and
  // the mapAsync readback is fire-and-forget, so encoding a new pick copy while
  // the previous map is still pending fails validation ("used in submit while
  // pending map") and can poison the whole frame's submit. Rapid clicks queue
  // in `pending` (latest-wins) and encode once the buffer frees.
  private inFlight = false;
  // fast path: G-buffer id read (one workgroup), built once at init
  private fastPipeline: GPUComputePipeline | null = null;
  private fastMsPipeline: GPUComputePipeline | null = null;
  private fastParamsBuf: GPUBuffer | null = null;
  private fastOutBuf: GPUBuffer | null = null;
  private fastBind: GPUBindGroup | null = null;
  private fastBindId: GPUTexture | null = null;
  private fastBindDepth: GPUTexture | null = null;

  /** Build the fast path's pipelines (both sample counts) and its buffers.
   *  Eager, not lazy: this is the path almost every pick takes, and a shader
   *  compile on the first click is exactly the hitch we are removing. */
  init(dev: GPUDevice): void {
    const compute = (code: string, label: string) =>
      dev.createComputePipeline({
        label,
        layout: 'auto',
        compute: { module: dev.createShaderModule({ label, code }), entryPoint: 'main' },
      });
    this.fastPipeline = compute(pickItemIdWgsl(false), 'pickItemIdPipeline');
    this.fastMsPipeline = compute(pickItemIdWgsl(true), 'pickItemIdMsPipeline');
    this.fastParamsBuf = dev.createBuffer({
      label: 'pickItemParamsBuf',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.fastOutBuf = dev.createBuffer({
      label: 'pickItemOutBuf',
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
  }

  /** An unconsumed request blocks the renderer's idle skip. */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Read the item id under a device pixel. Resolves null on background; a
   *  newer request cancels (null-resolves) the queued one. */
  request(x: number, y: number, shift: boolean): Promise<number | null> {
    return new Promise((resolve) => {
      this.pending?.resolve(null);
      this.pending = { x, y, shift, resolve };
    });
  }

  /** Encode a queued pick — the fast G-buffer read when the scene is fully
   *  opaque, the scene replay otherwise. Returns the post-submit resolve job,
   *  or null when there is nothing to pick or a readback is still in flight. */
  encode(
    enc: GPUCommandEncoder,
    dev: GPUDevice,
    canvas: HTMLCanvasElement,
    opt: PickOptions,
    cullMode: 'mdi' | 'vp' | 'full',
    frameData: ArrayBuffer,
    frameBuf: GPUBuffer,
    countsBuf: GPUBuffer,
    models: GpuModel[],
    mdiPipeline: GPURenderPipeline,
    vpPipeline: GPURenderPipeline,
    timings: GpuTimings,
    gbuf: PickGbuffer | null,
  ): (() => void) | null {
    if (!this.pending || this.inFlight) {
      return null;
    }
    const req = this.pending;
    this.pending = null;
    this.inFlight = true;
    if (gbuf && !opt.hasTransparency && this.fastPipeline && this.fastMsPipeline) {
      return this.encodeFast(enc, dev, canvas, gbuf, req, timings);
    }

    // (re)create the pick targets at the canvas size
    if (!this.pickIdTex || this.pickIdTex.width !== canvas.width || this.pickIdTex.height !== canvas.height) {
      this.pickIdTex?.destroy();
      this.pickDepthTex?.destroy();
      this.pickIdTex = dev.createTexture({
        label: 'pickIdTex',
        size: [canvas.width, canvas.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      this.pickDepthTex = dev.createTexture({
        label: 'pickDepthTex',
        size: [canvas.width, canvas.height],
        format: 'depth32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
    // Re-render the id buffer through the PICK pipelines (native mesh_pick):
    // the fragment discards items on the wrong side of the opacity
    // threshold, so the winning id is what the rule says the click hits.
    // Pick frame slot @512: blend routing off; ambient.xy = threshold/shift.
    const pickFrame = new ArrayBuffer(FRAME_SIZE);
    new Uint8Array(pickFrame).set(new Uint8Array(frameData));
    const pfu = new Uint32Array(pickFrame);
    pfu[FRAME_SLOT.flags + 2] = 0; // no blend routing — glass renders (and applies the rule)
    const pff = new Float32Array(pickFrame);
    pff[FRAME_SLOT.ambient] = opt.pickOpacityPct / 100;
    pff[FRAME_SLOT.ambient + 1] = req.shift ? 1 : 0;
    dev.queue.writeBuffer(frameBuf, 512, pickFrame);
    const x = Math.min(Math.max(req.x, 0), canvas.width - 1);
    const y = Math.min(Math.max(req.y, 0), canvas.height - 1);
    const pick = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.pickIdTex!.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      timestampWrites: timings.writes(11),
      depthStencilAttachment: {
        view: this.pickDepthTex!.createView(),
        depthClearValue: 0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    // only the cursor texel is ever read back — scissor away all other
    // fragment/depth work (vertex work still runs; the clear ignores the
    // scissor, so the rest of the target stays background id 0)
    pick.setScissorRect(x, y, 1, 1);
    replayDrawLists(pick, models, countsBuf, cullMode, mdiPipeline, vpPipeline, 512);
    pick.end();
    const buf = this.readbackBuf(dev);
    enc.copyTextureToBuffer({ texture: this.pickIdTex!, origin: [x, y] }, { buffer: buf, bytesPerRow: 256 }, [1, 1]);
    return this.resolveJob(buf, req);
  }

  /** Fast path: one workgroup reads the id the main pass already wrote to the
   *  G-buffer under the cursor. No geometry, no pick targets. */
  private encodeFast(
    enc: GPUCommandEncoder,
    dev: GPUDevice,
    canvas: HTMLCanvasElement,
    gbuf: PickGbuffer,
    req: PickRequest,
    timings: GpuTimings,
  ): () => void {
    // clamped against the canvas here, and again in the shader against the
    // target a resize since may have shrunk (as the depth pick does)
    const x = Math.min(Math.max(req.x, 0), canvas.width - 1);
    const y = Math.min(Math.max(req.y, 0), canvas.height - 1);
    dev.queue.writeBuffer(this.fastParamsBuf!, 0, new Uint32Array([x, y, 0, 0]));
    const pipeline = gbuf.msaa ? this.fastMsPipeline! : this.fastPipeline!;
    if (!this.fastBind || this.fastBindId !== gbuf.id || this.fastBindDepth !== gbuf.depth) {
      this.fastBind = dev.createBindGroup({
        label: 'pickItemFastBind',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: gbuf.id.createView() },
          // the 1-sample shader never reads depth, so it declares no such
          // binding and the auto layout has no slot for it
          ...(gbuf.msaa ? [{ binding: 1, resource: gbuf.depth.createView() }] : []),
          { binding: 2, resource: { buffer: this.fastParamsBuf! } },
          { binding: 3, resource: { buffer: this.fastOutBuf! } },
        ],
      });
      this.fastBindId = gbuf.id;
      this.fastBindDepth = gbuf.depth;
    }
    const pass = enc.beginComputePass({ label: 'pickItemFast', timestampWrites: timings.writes(11) });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.fastBind);
    pass.dispatchWorkgroups(1);
    pass.end();
    const buf = this.readbackBuf(dev);
    enc.copyBufferToBuffer(this.fastOutBuf!, 0, buf, 0, 4);
    return this.resolveJob(buf, req);
  }

  /** The shared 1-texel readback buffer (256 keeps copy alignment trivial). */
  private readbackBuf(dev: GPUDevice): GPUBuffer {
    this.itemPickBuf ??= dev.createBuffer({
      label: 'itemPickBuf',
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    return this.itemPickBuf;
  }

  /** Post-submit job both paths share: map the readback, unpack the little-
   *  endian id, resolve the caller and free the in-flight slot. */
  private resolveJob(buf: GPUBuffer, req: PickRequest): () => void {
    return async () => {
      try {
        await buf.mapAsync(GPUMapMode.READ);
        const px = new Uint8Array(buf.getMappedRange(0, 4)).slice();
        buf.unmap();
        const id = px[0] | (px[1] << 8) | (px[2] << 16) | (px[3] << 24);
        req.resolve(id === 0 ? null : id >>> 0);
      } catch {
        req.resolve(null);
      } finally {
        this.inFlight = false;
      }
    };
  }
}
