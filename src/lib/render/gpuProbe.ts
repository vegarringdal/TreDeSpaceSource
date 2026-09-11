// WebGPU cannot enumerate GPUs — it can only be ASKED for a high-performance,
// a low-power, or a software-fallback adapter. Probing all three and comparing
// what comes back is the one way to learn whether a machine has two GPUs and
// which one each hint resolves to. Shared by Settings → GPU and `gpu.info.get`.

/** The three adapter requests a browser understands. */
export type AdapterHint = 'high-performance' | 'low-power' | 'fallback';

export const ADAPTER_HINTS: readonly AdapterHint[] = ['high-performance', 'low-power', 'fallback'];

/** What `GPUAdapter.info` says about a physical adapter. Chrome fills in
 *  `device` and `description` only with "WebGPU Developer Features" on;
 *  vendor + architecture are always there and are enough to tell GPUs apart. */
export interface AdapterFacts {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  /** a software rasterizer (SwiftShader), not a GPU */
  isFallback: boolean;
}

export function adapterFacts(adapter: GPUAdapter, forcedFallback = false): AdapterFacts {
  const i = adapter.info;
  return {
    vendor: i.vendor,
    architecture: i.architecture,
    device: i.device,
    description: i.description,
    isFallback: Boolean(i.isFallbackAdapter) || forcedFallback,
  };
}

/** True when both describe the same physical adapter. */
export function sameAdapter(a: AdapterFacts, b: AdapterFacts): boolean {
  return (
    a.vendor === b.vendor &&
    a.architecture === b.architecture &&
    a.device === b.device &&
    a.description === b.description
  );
}

/** One display string for an adapter: the most specific field the browser gave. */
export function adapterLabel(f: AdapterFacts | null): string {
  if (!f) {
    return 'not available';
  }
  return (f.description || f.device || f.architecture || f.vendor).trim() || 'unknown adapter';
}

/** Request an adapter for one hint; null when the browser has none for it. */
export async function requestAdapterFor(hint: AdapterHint): Promise<GPUAdapter | null> {
  try {
    const a = await navigator.gpu?.requestAdapter({
      powerPreference: hint === 'fallback' ? undefined : hint,
      forceFallbackAdapter: hint === 'fallback',
    });
    return a ?? null;
  } catch {
    return null;
  }
}

/** What each hint resolves to on this machine. Cheap (three adapter
 *  requests, no device), so callers need not cache it. */
export async function probeAdapters(): Promise<Record<AdapterHint, AdapterFacts | null>> {
  const out: Record<AdapterHint, AdapterFacts | null> = { 'high-performance': null, 'low-power': null, fallback: null };
  for (const hint of ADAPTER_HINTS) {
    const a = await requestAdapterFor(hint);
    out[hint] = a ? adapterFacts(a, hint === 'fallback') : null;
  }
  return out;
}
