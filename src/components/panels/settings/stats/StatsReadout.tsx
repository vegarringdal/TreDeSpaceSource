import { Button } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import { collectStats, type StatRow as StatRowData, type StatsSnapshot } from '../../../../state/viewer/statsRows';
import { getRenderer, viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';

const POLL_MS = 500;

type RowProps = Readonly<{
  row: StatRowData;
  /** shown in the viewport overlay (checkbox) */
  inOverlay: boolean;
  onToggle: (key: string, on: boolean) => void;
}>;

/** One read-only label/value line, with the checkbox that includes it in the
 *  viewport overlay. */
function StatRow({ row, inOverlay, onToggle }: RowProps) {
  return (
    <>
      <input
        type="checkbox"
        className="self-center"
        checked={inOverlay}
        data-tooltip="Show this row in the viewport overlay"
        onChange={(e) => onToggle(row.key, e.target.checked)}
      />
      <span className="text-slate-400">{row.label}</span>
      <span className="select-text text-right font-mono text-slate-200">{row.value}</span>
    </>
  );
}

/** Poll the registered renderer twice a second into stat + GPU-timing rows. */
function useRendererStats() {
  const [snap, setSnap] = useState<StatsSnapshot>({ rows: [], gpuRows: [] });
  const [err, setErr] = useState('');
  useEffect(() => {
    const t = setInterval(() => {
      const r = getRenderer();
      setErr(r?.gpuError ?? '');
      setSnap(collectStats(r));
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);
  return { snap, err };
}

/** Live renderer stats — the GPU error lives in its OWN block whose content
 *  only changes when the error does, so a text selection over it survives the
 *  twice-a-second stats refresh. Each row's checkbox picks whether the
 *  viewport overlay shows it (the overlay is this same list). */
export function StatsReadout() {
  const { snap, err } = useRendererStats();
  const { statsHidden } = useViewer();
  const [copied, setCopied] = useState(false);
  const hidden = new Set(statsHidden);

  const copyErr = () => {
    void navigator.clipboard?.writeText(err).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const handleToggle = (key: string, on: boolean) => {
    const next = statsHidden.filter((k) => k !== key);
    viewerActions.update({ statsHidden: on ? next : [...next, key] });
  };

  const grid = (rows: StatRowData[]) => (
    <div className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {rows.map((row) => (
        <StatRow key={row.key} row={row} inOverlay={!hidden.has(row.key)} onToggle={handleToggle} />
      ))}
    </div>
  );

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
      {grid(snap.rows)}
      {snap.gpuRows.length > 0 && (
        <div className="flex flex-col gap-1 border-slate-800 border-t pt-1.5">
          <span className="font-medium text-[11px] text-slate-400">GPU pass times</span>
          {grid(snap.gpuRows)}
        </div>
      )}
    </div>
  );
}
