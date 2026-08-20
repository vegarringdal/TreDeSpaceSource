import { Button } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import { residency } from '../../../../state/viewer/residency';
import { getRenderer } from '../../../../state/viewer/viewer.actions';
import { viewerState } from '../../../../state/viewer/viewer.state';

/** One read-only label/value line in the stats form. */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-slate-400">{label}</span>
      <span className="select-text text-right font-mono text-slate-200">{value}</span>
    </>
  );
}

/** Poll the registered renderer twice a second into stat + GPU-timing rows. */
function useRendererStats() {
  const [rows, setRows] = useState<[string, string][]>([]);
  const [gpuRows, setGpuRows] = useState<[string, string][]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setInterval(() => {
      const r = getRenderer();
      if (!r) {
        setRows([['renderer', 'none']]);
        setGpuRows([]);
        return;
      }
      setErr(r.gpuError ?? '');
      const s = r.stats;
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
      setRows([
        ['adapter', r.adapterInfo],
        ['models', String(s.models)],
        ['meshlets', s.meshlets.toLocaleString()],
        ['triangles', s.tris.toLocaleString()],
        [
          'culling',
          r.cullMode === 'full' ? 'none (no MDI; enable vertex-pull)' : r.cullMode === 'vp' ? 'vertex-pull' : 'MDI',
        ],
        ...(r.cullMode === 'full'
          ? []
          : ([['drawn p1 / p2', `${r.drawnPass1.toLocaleString()} / ${r.drawnPass2.toLocaleString()}`]] as [
              string,
              string,
            ][])),
        [
          'vram (tracked)',
          `${((r.vramBuffers + r.vramTextures) / 1048576).toFixed(0)} MB (buf ${(r.vramBuffers / 1048576).toFixed(0)} + tex ${(r.vramTextures / 1048576).toFixed(0)})`,
        ],
        ...(viewerState.get().maxVramMb > 0
          ? ([
              [
                'vram budget',
                `${viewerState.get().maxVramMb} MB (${Math.round(((r.vramBuffers + r.vramTextures) / 1048576 / viewerState.get().maxVramMb) * 100)}% used)`,
              ],
              [
                'residency',
                (({ full, mixed, coarse, unloaded }) =>
                  `${full} full / ${mixed} mixed / ${coarse} coarse / ${unloaded} unloaded`)(residency.statsSummary()),
              ],
            ] as [string, string][])
          : []),
        ['js heap', `${(heap / 1048576).toFixed(0)} MB`],
        ...(r.idle
          ? ([['frame', 'idle']] as [string, string][])
          : ([
              ['fps', r.fps.toFixed(0)],
              ['cpu', `${r.cpuMs.toFixed(2)} ms`],
              ...(r.accumCount > 0 ? [['AA accumulation', `${r.accumCount} / ${r.aaMax}`]] : []),
            ] as [string, string][])),
      ]);
      setGpuRows(
        viewerState.get().gpuTimings && r.gpuTimes.length
          ? [
              ...r.gpuTimes.map((p) => [p.label, `${p.ms.toFixed(2)} ms`] as [string, string]),
              ['total', `${r.gpuTimes.reduce((a, p) => a + p.ms, 0).toFixed(2)} ms`],
            ]
          : [],
      );
    }, 500);
    return () => clearInterval(t);
  }, []);
  return { rows, gpuRows, err };
}

/** Live renderer stats — the GPU error lives in its OWN block whose content
 *  only changes when the error does, so a text selection over it survives the
 *  twice-a-second stats refresh. */
export function StatsReadout() {
  const { rows, gpuRows, err } = useRendererStats();
  const [copied, setCopied] = useState(false);

  const copyErr = () => {
    void navigator.clipboard?.writeText(err).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {err && (
        <div className="flex flex-col gap-1 border border-red-900 bg-red-950/40 p-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[11px] text-red-300">GPU error</span>
            <Button className="ml-auto h-5 px-2 text-[10px]" onClick={copyErr}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="max-h-40 select-text overflow-auto whitespace-pre-wrap font-mono text-[11px] text-red-200">
            {err}
          </pre>
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {rows.map(([label, value]) => (
          <StatRow key={label} label={label} value={value} />
        ))}
      </div>
      {gpuRows.length > 0 && (
        <div className="flex flex-col gap-1 border-slate-800 border-t pt-1.5">
          <span className="font-medium text-[11px] text-slate-400">GPU pass times</span>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {gpuRows.map(([label, value]) => (
              <StatRow key={label} label={label} value={value} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
