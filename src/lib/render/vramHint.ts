// Adapter facts captured at renderer init, for the GPU info the settings panel
// and `gpu.info.get` report. WebGPU cannot see a GPU's VRAM, so the viewer
// offers no budget suggestion — the Max VRAM ceiling is the user's call.

/** Adapter facts captured at renderer init. */
export interface AdapterHints {
  vendor: string;
  architecture: string;
  maxBufferSize: number;
  /** `navigator.deviceMemory` in GB (Chromium caps it at 8), 0 when unknown. */
  deviceMemoryGb: number;
  isMobile: boolean;
}

/** `navigator.deviceMemory` without widening the DOM lib: 0 when absent. */
export function readDeviceMemoryGb(): number {
  const nav: unknown = typeof navigator === 'undefined' ? null : navigator;
  if (typeof nav !== 'object' || nav === null || !('deviceMemory' in nav)) {
    return 0;
  }
  const v = (nav as { deviceMemory?: unknown }).deviceMemory;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
