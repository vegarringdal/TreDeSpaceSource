// Laser-scan point clouds on the GPU: one storage buffer per streamed .tdpp
// node, drawn as instanced screen-aligned squares in the last scene pass
// (shaders/points.ts). The layer only owns GPU objects; which nodes exist and
// which are drawn is decided by the streamer (state/scans/scanPoints.ts).
import { POINT_HEADER_WORDS, POINT_WORDS, pointsWgsl } from './shaders';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

export type PointColorMode = 'rgb' | 'intensity';

export interface PointStyle {
  /** Point size in CSS px (the minimum when adaptive). */
  readonly sizePx: number;
  /** Grow points to the node's projected spacing (fills gaps up close). */
  readonly adaptive: boolean;
  readonly colorMode: PointColorMode;
  /** Points farther from the eye than this are not drawn, metres (0 = no limit; perspective only). */
  readonly maxDistance: number;
}

/** One uploaded node. */
export interface PointNodeGpu {
  readonly count: number;
  readonly buf: GPUBuffer;
  readonly bind: GPUBindGroup;
}

/** One cloud to draw this frame: its absolute origin and its drawn nodes. */
export interface PointCloudDraw {
  readonly id: string;
  /** Absolute origin the node positions are relative to (f64). */
  readonly origin: Vec3;
  /** Row-major 3×3 rotation from the nodes' axes to the scene's (a source
   *  with a rotated coordinate system); null / unset = the same axes. */
  readonly axes?: readonly number[] | null;
  readonly nodes: readonly PointNodeGpu[];
}

interface CloudGpu {
  readonly uni: GPUBuffer;
  readonly bind: GPUBindGroup;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Cloud uniform: rel, view, mode (16 B each) + a mat3x3f (3 padded columns). */
const CLOUD_UNIFORM_BYTES = 96;
const IDENTITY_AXES = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;
const VERTS_PER_POINT = 6;
/** Largest adaptive point size, CSS px. */
const ADAPTIVE_MAX_PX = 24;
const DEFAULT_STYLE: PointStyle = { sizePx: 2, adaptive: false, colorMode: 'rgb', maxDistance: 0 };

export class PointsLayer {
  private device: GPUDevice | null = null;
  private pipelines: [GPURenderPipeline, GPURenderPipeline] | null = null;
  private cloudLayout: GPUBindGroupLayout | null = null;
  private nodeLayout: GPUBindGroupLayout | null = null;
  private frameBuf: GPUBuffer | null = null;
  private clipBuf: GPUBuffer | null = null;
  private clouds: readonly PointCloudDraw[] = [];
  private readonly cloudGpu = new Map<string, CloudGpu>();
  private style: PointStyle = DEFAULT_STYLE;
  private version = 0;

  init(dev: GPUDevice, format: GPUTextureFormat, frameBuf: GPUBuffer, clipBuf: GPUBuffer) {
    this.device = dev;
    this.frameBuf = frameBuf;
    this.clipBuf = clipBuf;
    const vf = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.cloudLayout = dev.createBindGroupLayout({
      label: 'pointsCloudBGL',
      entries: [
        { binding: 0, visibility: vf, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 2, visibility: vf, buffer: { type: 'uniform' } },
      ],
    });
    this.nodeLayout = dev.createBindGroupLayout({
      label: 'pointsNodeBGL',
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
    });
    const module = dev.createShaderModule({ label: 'pointsModule', code: pointsWgsl() });
    const layout = dev.createPipelineLayout({ bindGroupLayouts: [this.cloudLayout, this.nodeLayout] });
    const make = (sampleCount: number) =>
      dev.createRenderPipeline({
        label: sampleCount > 1 ? 'pointsPipeline4x' : 'pointsPipeline',
        layout,
        vertex: { module, entryPoint: 'vs' },
        fragment: {
          module,
          entryPoint: 'fs',
          // colour, G-buffer normal (+ tag bits in alpha), item id (0 = none)
          targets: [{ format }, { format: 'rgba8unorm' }, { format: 'rgba8unorm' }],
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
        multisample: { count: sampleCount },
      });
    this.pipelines = [make(1), make(4)];
  }

  private nodeBytes = 0;

  /** Upload one node: `words` = 4 header words + 4 words per point (see
   *  shaders/points.ts). Null before init. */
  createNode(words: Uint32Array<ArrayBuffer>, count: number): PointNodeGpu | null {
    const dev = this.device;
    if (!dev || !this.nodeLayout || words.length < POINT_HEADER_WORDS + count * POINT_WORDS) {
      return null;
    }
    const buf = dev.createBuffer({
      label: 'pointsNode',
      size: words.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(buf, 0, words);
    this.nodeBytes += buf.size;
    const bind = dev.createBindGroup({
      label: 'pointsNodeBind',
      layout: this.nodeLayout,
      entries: [{ binding: 0, resource: { buffer: buf } }],
    });
    return { count, buf, bind };
  }

  /** Rewrite a node's effective spacing (the adaptive size's reference). */
  setNodeSpacing(node: PointNodeGpu, spacing: number) {
    this.device?.queue.writeBuffer(node.buf, 0, new Float32Array([spacing]));
  }

  destroyNode(node: PointNodeGpu) {
    this.nodeBytes -= node.buf.size;
    node.buf.destroy();
  }

  /** GPU bytes held by the uploaded point nodes — streamed under the point
   *  budget of the Scans panel, so kept out of the model VRAM budget. */
  get bytes(): number {
    return this.nodeBytes;
  }

  /** What to draw from now on (the streamer calls this when it changes). */
  setClouds(clouds: readonly PointCloudDraw[]) {
    this.clouds = clouds;
    this.version++;
    const live = new Set(clouds.map((c) => c.id));
    for (const [id, g] of this.cloudGpu) {
      if (!live.has(id)) {
        g.uni.destroy();
        this.cloudGpu.delete(id);
      }
    }
  }

  setStyle(style: PointStyle) {
    const s = this.style;
    if (
      s.sizePx === style.sizePx &&
      s.adaptive === style.adaptive &&
      s.colorMode === style.colorMode &&
      s.maxDistance === style.maxDistance
    ) {
      return;
    }
    this.style = style;
    this.version++;
  }

  get active(): boolean {
    return this.clouds.some((c) => c.nodes.length > 0);
  }

  /** Breaks the renderer's idle skip whenever what is drawn changes. */
  get stateKey(): string {
    return `pts:${this.version}`;
  }

  /** Per-frame cloud uniforms: the origin offset is subtracted in f64 here so
   *  the f32 the GPU sees stays small (camera-relative rendering). */
  prepare(frameOrigin: Vec3, width: number, height: number, projY: number, dpr: number) {
    const dev = this.device;
    if (!dev || !this.active) {
      return;
    }
    for (const c of this.clouds) {
      const g = this.cloudGpuFor(dev, c.id);
      if (!g) {
        continue;
      }
      const data = new ArrayBuffer(CLOUD_UNIFORM_BYTES);
      const f = new Float32Array(data);
      const u = new Uint32Array(data);
      f.set(
        [
          c.origin[0] - frameOrigin[0],
          c.origin[1] - frameOrigin[1],
          c.origin[2] - frameOrigin[2],
          this.style.sizePx * dpr,
          width,
          height,
          projY,
          ADAPTIVE_MAX_PX * dpr,
        ],
        0,
      );
      u[8] = this.style.colorMode === 'intensity' ? 1 : 0;
      u[9] = this.style.adaptive ? 1 : 0;
      f[10] = Math.max(0, this.style.maxDistance);
      // columns of the axes rotation, each padded to 16 B
      const m = c.axes ?? IDENTITY_AXES;
      f.set([m[0], m[3], m[6], 0, m[1], m[4], m[7], 0, m[2], m[5], m[8], 0], 12);
      dev.queue.writeBuffer(g.uni, 0, data);
    }
  }

  /** Draw every cloud into the open scene pass (after the model, before the
   *  helper overlays — they depth-test against the points). */
  draw(pass: GPURenderPassEncoder, msaa: boolean) {
    if (!this.pipelines || !this.active) {
      return;
    }
    pass.setPipeline(this.pipelines[msaa ? 1 : 0]);
    for (const c of this.clouds) {
      const g = this.cloudGpu.get(c.id);
      if (!g) {
        continue;
      }
      pass.setBindGroup(0, g.bind);
      for (const n of c.nodes) {
        if (n.count === 0) {
          continue; // a node the setup filter emptied
        }
        pass.setBindGroup(1, n.bind);
        pass.draw(VERTS_PER_POINT, n.count);
      }
    }
  }

  private cloudGpuFor(dev: GPUDevice, id: string): CloudGpu | null {
    const have = this.cloudGpu.get(id);
    if (have) {
      return have;
    }
    if (!this.cloudLayout || !this.frameBuf || !this.clipBuf) {
      return null;
    }
    const uni = dev.createBuffer({
      label: 'pointsCloudUni',
      size: CLOUD_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bind = dev.createBindGroup({
      label: 'pointsCloudBind',
      layout: this.cloudLayout,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuf } },
        { binding: 1, resource: { buffer: this.clipBuf } },
        { binding: 2, resource: { buffer: uni } },
      ],
    });
    const g = { uni, bind };
    this.cloudGpu.set(id, g);
    return g;
  }
}
