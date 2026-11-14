// Laser-scan photo overlay: one scanner setup's photo — six cube faces or one
// spherical image — drawn after post onto the swapchain (never enters the TAA
// history), every frame including hold frames, like the view cube. The photo
// manager (state/scans/scanPhoto.ts) uploads the images, sharpening single
// faces on zoom; the camera is expected to sit at the setup position (scan
// look-around mode) for the photo to line up with the model.
import type { CameraController } from './camera';
import type { GpuTimings } from './gpuTimings';
import { screenBasis, worldToPhotoRows } from './panoMath';
import { panoWgsl } from './shaders';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type PanoMode = 'background' | 'over';

export interface PanoView {
  /** Photo frame → world rotation [w, x, y, z] (cube: the setup's; sphere: the image's). */
  readonly rotation: readonly [number, number, number, number];
  /** 0..1 */
  readonly opacity: number;
  readonly mode: PanoMode;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const UNIFORM_BYTES = 6 * 16;
const FACE_COUNT = 6;
const RGBA_BYTES = 4;
const FACE_BINDING = 3;
const SPHERE_BINDING = FACE_BINDING + FACE_COUNT;
/** GPU timing slot of the pano pass (gpuTimings.ts TS_PASSES). */
const PANO_TIMING_SLOT = 12;

export class PanoPass {
  private device: GPUDevice | null = null;
  private pipelines: [GPURenderPipeline, GPURenderPipeline] | null = null;
  private uni: GPUBuffer | null = null;
  private sampler: GPUSampler | null = null;
  /** 1 × 1 stand-in for the textures a photo does not use. */
  private blank: GPUTexture | null = null;
  private faces: (GPUTexture | null)[] = Array.from({ length: FACE_COUNT }, () => null);
  private sphere: GPUTexture | null = null;
  /** Azimuth / elevation the spherical image covers, radians. */
  private sphereSpan: readonly [number, number] = [0, 0];
  private photoVersion = 0;
  private view: PanoView | null = null;

  init(dev: GPUDevice, format: GPUTextureFormat) {
    this.device = dev;
    this.uni = dev.createBuffer({
      label: 'panoUni',
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = dev.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.blank = dev.createTexture({
      label: 'panoBlank',
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
    const make = (msaa: boolean) => {
      const module = dev.createShaderModule({ label: msaa ? 'panoModule4x' : 'panoModule', code: panoWgsl(msaa) });
      return dev.createRenderPipeline({
        label: msaa ? 'panoPipeline4x' : 'panoPipeline',
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: {
          module,
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
        primitive: { topology: 'triangle-list' },
      });
    };
    this.pipelines = [make(false), make(true)];
  }

  /** Largest texture edge the device takes (photos are downscaled to it). */
  get maxTextureSize(): number {
    return this.device?.limits.maxTextureDimension2D ?? 0;
  }

  /** Replace one cube face (CUBE_FACES order); faces may differ in size. */
  setFace(layer: number, image: ImageBitmap) {
    if (layer < 0 || layer >= FACE_COUNT) {
      return;
    }
    this.dropSphere();
    this.faces[layer]?.destroy();
    this.faces[layer] = this.upload(image, 'panoFace');
    this.photoVersion++;
  }

  /** Show a spherical image covering `spanAzimuth` × `spanElevation` radians
   *  around the photo frame's +X; replaces a cube photo. */
  setSphere(image: ImageBitmap, spanAzimuth: number, spanElevation: number) {
    this.clearPhoto();
    this.sphere = this.upload(image, 'panoSphere');
    this.sphereSpan = [spanAzimuth, spanElevation];
    this.photoVersion++;
  }

  /** Drop every photo texture. */
  clearPhoto() {
    for (const [i, t] of this.faces.entries()) {
      t?.destroy();
      this.faces[i] = null;
    }
    this.dropSphere();
    this.photoVersion++;
  }

  /** GPU bytes of the photo textures held now (RGBA8, no mips). */
  get bytes(): number {
    let sum = 0;
    for (const t of [...this.faces, this.sphere]) {
      sum += t ? t.width * t.height * RGBA_BYTES : 0;
    }
    return sum;
  }

  /** Rotation / opacity / mode for the current setup; null hides the photo. */
  setView(view: PanoView | null) {
    this.view = view;
  }

  get active(): boolean {
    const has = this.sphere !== null || this.faces.some((f) => f !== null);
    return this.view !== null && has && this.view.opacity > 0;
  }

  /** Breaks the renderer's idle skip whenever what the photo shows changes. */
  get stateKey(): string {
    const v = this.view;
    return v ? `pano:${this.photoVersion}:${v.mode}:${v.opacity}:${v.rotation.join(',')}` : 'pano:off';
  }

  /** Composite onto `target` (after post). `depth` is the scene depth;
   *  `msaa` = it is the 4× multisampled one. */
  draw(
    enc: GPUCommandEncoder,
    target: GPUTextureView,
    depth: GPUTexture,
    msaa: boolean,
    camera: CameraController,
    aspect: number,
    timings: GpuTimings,
  ) {
    const dev = this.device;
    const v = this.view;
    const blank = this.blank;
    if (!dev || !this.pipelines || !this.uni || !this.sampler || !blank || !v || camera.ortho) {
      return;
    }
    const f = camera.forward();
    const { right, up } = screenBasis(f);
    const tanY = Math.tan(camera.fovY / 2);
    const rows = worldToPhotoRows(v.rotation);
    const data = new Float32Array([
      ...right,
      tanY * aspect,
      ...up,
      tanY,
      ...f,
      Math.min(1, Math.max(0, v.opacity)),
      ...rows[0],
      v.mode === 'over' ? 1 : 0,
      ...rows[1],
      this.sphere ? this.sphereSpan[0] : 0,
      ...rows[2],
      this.sphereSpan[1],
    ]);
    dev.queue.writeBuffer(this.uni, 0, data);
    const pipeline = this.pipelines[msaa ? 1 : 0];
    const bind = dev.createBindGroup({
      label: 'panoBind',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uni } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: depth.createView({ aspect: 'depth-only' }) },
        ...this.faces.map((t, i) => ({ binding: FACE_BINDING + i, resource: (t ?? blank).createView() })),
        { binding: SPHERE_BINDING, resource: (this.sphere ?? blank).createView() },
      ],
    });
    const pass = enc.beginRenderPass({
      timestampWrites: timings.writes(PANO_TIMING_SLOT),
      colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
  }

  private dropSphere() {
    this.sphere?.destroy();
    this.sphere = null;
    this.sphereSpan = [0, 0];
  }

  private upload(image: ImageBitmap, label: string): GPUTexture | null {
    const dev = this.device;
    if (!dev) {
      return null;
    }
    const tex = dev.createTexture({
      label,
      size: [image.width, image.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    dev.queue.copyExternalImageToTexture({ source: image }, { texture: tex }, [image.width, image.height]);
    return tex;
  }
}
