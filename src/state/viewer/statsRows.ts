import type { Renderer } from '../../lib/render/renderer';
import { residency } from './residency';
import { viewerState } from './viewer.state';

export type StatRow = Readonly<{ key: string; label: string; value: string }>;

export type StatsSnapshot = Readonly<{
  rows: StatRow[];
  /** per-pass GPU times (empty unless `gpuTimings` is on and supported) */
  gpuRows: StatRow[];
}>;

/** Stable key for a GPU pass row — the overlay hide-list addresses rows by key. */
export const gpuRowKey = (label: string): string => `gpu:${label}`;

const MB = 1048576;

const mb = (bytes: number): string => (bytes / MB).toFixed(0);

const NONE = '—';

/**
 * One snapshot of the renderer's live stats as label/value rows. Shared by
 * the Settings → Stats readout and the viewport overlay so both show the same
 * list; `key` is what the overlay's per-row checkbox toggles. The row SET is
 * fixed — a row whose value does not apply right now shows `—` instead of
 * disappearing, so neither list ever shifts its layout.
 */
export function collectStats(r: Renderer | null): StatsSnapshot {
  if (!r) {
    return { rows: [{ key: 'renderer', label: 'renderer', value: 'none' }], gpuRows: [] };
  }
  const st = viewerState.get();
  const s = r.stats;
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  const vram = r.vramBuffers + r.vramTextures;
  const culls = r.cullMode !== 'full';
  const drawn = r.drawnPass1 + r.drawnPass2;
  const culledPct = s.meshlets > 0 ? (100 * (1 - drawn / s.meshlets)).toFixed(1) : '0.0';
  const res = st.maxVramMb > 0 ? residency.statsSummary() : null;
  const rows: StatRow[] = [
    { key: 'adapter', label: 'adapter', value: r.adapterInfo },
    { key: 'models', label: 'models', value: String(s.models) },
    { key: 'meshlets', label: 'meshlets', value: s.meshlets.toLocaleString() },
    { key: 'triangles', label: 'triangles', value: s.tris.toLocaleString() },
    {
      key: 'culling',
      label: 'culling',
      value: r.cullMode === 'full' ? 'none (no MDI; enable vertex-pull)' : r.cullMode === 'vp' ? 'vertex-pull' : 'MDI',
    },
    {
      key: 'drawn',
      label: 'drawn p1 / p2',
      value: culls ? `${r.drawnPass1.toLocaleString()} / ${r.drawnPass2.toLocaleString()}` : NONE,
    },
    {
      key: 'culled',
      label: 'culled',
      value: culls ? `${culledPct}% (${drawn.toLocaleString()} of ${s.meshlets.toLocaleString()} meshlets)` : NONE,
    },
    {
      key: 'vram',
      label: 'vram (tracked)',
      value: `${mb(vram)} MB (buf ${mb(r.vramBuffers)} + tex ${mb(r.vramTextures)})`,
    },
    {
      key: 'vramBudget',
      label: 'vram budget',
      value: res ? `${st.maxVramMb} MB (${Math.round((vram / MB / st.maxVramMb) * 100)}% used)` : NONE,
    },
    {
      key: 'residency',
      label: 'residency',
      value: res ? `${res.full} full / ${res.mixed} mixed / ${res.coarse} coarse / ${res.unloaded} unloaded` : NONE,
    },
    { key: 'jsHeap', label: 'js heap', value: `${mb(heap)} MB` },
    { key: 'frame', label: 'frame', value: r.idle ? 'idle' : 'rendering' },
    { key: 'fps', label: 'fps', value: r.idle ? NONE : r.fps.toFixed(0) },
    { key: 'cpu', label: 'cpu', value: r.idle ? NONE : `${r.cpuMs.toFixed(2)} ms` },
    { key: 'aa', label: 'AA accumulation', value: r.accumCount > 0 ? `${r.accumCount} / ${r.aaMax}` : NONE },
  ];
  const gpuRows: StatRow[] = st.gpuTimings
    ? [
        ...r.gpuTimes.map((p) => ({ key: gpuRowKey(p.label), label: p.label, value: `${p.ms.toFixed(2)} ms` })),
        {
          key: gpuRowKey('total'),
          label: 'total',
          value: r.gpuTimes.length ? `${r.gpuTimes.reduce((a, p) => a + p.ms, 0).toFixed(2)} ms` : NONE,
        },
      ]
    : [];
  return { rows, gpuRows };
}

/** The overlay's text: every row not hidden by the user, one `label  value`
 *  line each, with the GPU pass times as a second block — the same list as
 *  the Settings → Stats readout. */
export function formatOverlay(snap: StatsSnapshot, hidden: readonly string[]): string {
  const hide = new Set(hidden);
  const rows = snap.rows.filter((x) => !hide.has(x.key));
  const gpu = snap.gpuRows.filter((x) => !hide.has(x.key));
  const width = Math.max(0, ...rows.map((x) => x.label.length), ...gpu.map((x) => x.label.length + 2));
  const line = (x: StatRow, indent: string) => `${(indent + x.label).padEnd(width)}  ${x.value}`;
  const lines = rows.map((x) => line(x, ''));
  if (gpu.length > 0) {
    lines.push('GPU pass times', ...gpu.map((x) => line(x, '  ')));
  }
  return lines.join('\n');
}
