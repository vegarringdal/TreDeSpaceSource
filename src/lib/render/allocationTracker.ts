// Wrap a device's createBuffer/createTexture (and their destroy()) so every
// GPU allocation is counted without touching the call sites. WebGPU has no
// real VRAM query — this tracks our own allocations, decremented on destroy().

function texBytes(d: GPUTextureDescriptor): number {
  const bpp: Record<string, number> = {
    depth32float: 4,
    rgba8unorm: 4,
    bgra8unorm: 4,
    r32float: 4,
    r32uint: 4,
    rg8unorm: 2,
    rgba16float: 8,
  };
  const size = d.size;
  let w = 1;
  let h = 1;
  if (Symbol.iterator in size) {
    const dims = [...size];
    w = dims[0] ?? 1;
    h = dims[1] ?? 1;
  } else {
    w = size.width;
    h = size.height ?? 1;
  }
  let bytes = w * h * (bpp[d.format] ?? 4) * (d.sampleCount ?? 1);
  if ((d.mipLevelCount ?? 1) > 1) {
    bytes = Math.ceil((bytes * 4) / 3); // full chain
  }
  return bytes;
}

/** Patch `dev` so every buffer/texture allocation reports a byte delta
 *  (positive on create, negative on destroy) to the given callbacks. */
export function trackDeviceAllocations(
  dev: GPUDevice,
  onBufferBytes: (delta: number) => void,
  onTextureBytes: (delta: number) => void,
): void {
  const origBuf = dev.createBuffer.bind(dev);
  dev.createBuffer = (d: GPUBufferDescriptor) => {
    const buf = origBuf(d);
    onBufferBytes(d.size);
    const origDestroy = buf.destroy.bind(buf);
    let alive = true;
    buf.destroy = () => {
      if (alive) {
        alive = false;
        onBufferBytes(-d.size);
      }
      origDestroy();
    };
    return buf;
  };
  const origTex = dev.createTexture.bind(dev);
  dev.createTexture = (d: GPUTextureDescriptor) => {
    const tex = origTex(d);
    const bytes = texBytes(d);
    onTextureBytes(bytes);
    const origDestroy = tex.destroy.bind(tex);
    let alive = true;
    tex.destroy = () => {
      if (alive) {
        alive = false;
        onTextureBytes(-bytes);
      }
      origDestroy();
    };
    return tex;
  };
}
