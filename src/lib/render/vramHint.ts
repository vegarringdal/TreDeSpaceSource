// A SUGGESTED VRAM budget from what WebGPU lets us see of the adapter. WebGPU
// has no VRAM query, so this is a heuristic, deliberately small: it only
// speaks up where it can be roughly right (unified-memory and mobile GPUs,
// whose graphics memory is a slice of system RAM) and stays silent for
// discrete cards, where a wrong number would cost detail for nothing. Never
// applied automatically — the settings panel shows it with a "Use" button.

/** Adapter facts captured at renderer init. */
export interface AdapterHints {
  vendor: string;
  architecture: string;
  maxBufferSize: number;
  /** `navigator.deviceMemory` in GB (Chromium caps it at 8), 0 when unknown. */
  deviceMemoryGb: number;
  isMobile: boolean;
}

const MB_PER_GB_SHARE = 256;
const MOBILE_CAP_MB = 1024;
const INTEGRATED_MIN_MB = 1024;
const INTEGRATED_CAP_MB = 4096;
const INTEGRATED_VENDORS = ['intel', 'apple', 'arm', 'qualcomm', 'imagination', 'samsung'];
const AMD_INTEGRATED_ARCH = /gcn-?5|rdna.*(apu|igp)|vega|van ?gogh|phoenix|rembrandt|raphael|lucienne|renoir|cezanne/i;

/** Suggested `maxVramMb`, or null when the adapter is (or may be) a discrete
 *  card. A quarter of system RAM per GB, clamped: mobile ≤ 1 GB, integrated
 *  desktop parts 1–4 GB. */
export function suggestVramBudgetMb(h: AdapterHints | null): number | null {
  if (!h) {
    return null;
  }
  const vendor = h.vendor.toLowerCase();
  const share = h.deviceMemoryGb > 0 ? h.deviceMemoryGb * MB_PER_GB_SHARE : 0;
  if (h.isMobile) {
    return share > 0 ? Math.min(MOBILE_CAP_MB, share) : MOBILE_CAP_MB;
  }
  const integrated =
    INTEGRATED_VENDORS.some((v) => vendor.includes(v)) ||
    (vendor.includes('amd') && AMD_INTEGRATED_ARCH.test(h.architecture));
  if (!integrated) {
    return null;
  }
  if (share === 0) {
    return INTEGRATED_MIN_MB;
  }
  return Math.max(INTEGRATED_MIN_MB, Math.min(INTEGRATED_CAP_MB, share));
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
