// Click item-picking from a dedicated id render (native mesh_pick port): the
// scene draw lists replay through pick pipelines whose fragment discards items
// on the wrong side of the opacity threshold, one cursor texel is copied out,
// and the packed global id resolves the caller's promise. Owns its 1-sample
// targets — the main G-buffer is 4-sample under MSAA (not copyable, and the
// 1-sample pick pipelines couldn't render into it).

import { FRAME_SIZE, FRAME_SLOT } from './frameLayout';
import { type GpuModel, replayDrawLists } from './gpuModel';
import type { GpuTimings } from './gpuTimings';

/** The `options` fields the pick pass reads. */
interface PickOptions {
  /** items at/above this opacity % are clickable and block clicks; below it
   *  clicks pass through. Shift inverts the band. */
  pickOpacityPct: number;
}

export class ItemPickPass {
  private itemPickBuf: GPUBuffer | null = null;
  private pickIdTex: GPUTexture | null = null;
  private pickDepthTex: GPUTexture | null = null;
  private pending: {
    x: number;
    y: number;
    shift: boolean;
    resolve: (id: number | null) => void;
  } | null = null;
  // one item-pick readback at a time: itemPickBuf is a single shared buffer and
  // the mapAsync readback is fire-and-forget, so encoding a new pick copy while
  // the previous map is still pending fails validation ("used in submit while
  // pending map") and can poison the whole frame's submit. Rapid clicks queue
  // in `pending` (latest-wins) and encode once the buffer frees.
  private inFlight = false;

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

  /** Encode the item-pick pass (native mesh_pick port) + 1px id copy. Returns
   *  the post-submit resolve job, or null. */
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
  ): (() => void) | null {
    if (!this.pending || this.inFlight) {
      return null;
    }
    const req = this.pending;
    this.pending = null;
    this.inFlight = true;
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
      timestampWrites: timings.writes(10),
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
    if (!this.itemPickBuf) {
      this.itemPickBuf = dev.createBuffer({
        label: 'itemPickBuf',
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    const buf = this.itemPickBuf;
    enc.copyTextureToBuffer({ texture: this.pickIdTex!, origin: [x, y] }, { buffer: buf, bytesPerRow: 256 }, [1, 1]);
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
