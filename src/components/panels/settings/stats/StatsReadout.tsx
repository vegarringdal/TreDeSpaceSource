import { Checkbox, CopyButton, PropertyList, type PropertyRow } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import { collectStats, type StatRow as StatRowData, type StatsSnapshot } from '../../../../state/viewer/statsRows';
import { getRenderer, viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';

const POLL_MS = 500;

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
  const hidden = new Set(statsHidden);

  const handleToggle = (key: string, on: boolean) => {
    const next = statsHidden.filter((k) => k !== key);
    viewerActions.update({ statsHidden: on ? next : [...next, key] });
  };

  const toRows = (rows: StatRowData[]): PropertyRow[] =>
    rows.map((row) => ({
      key: row.key,
      label: row.label,
      value: row.value,
      leading: (
        <Checkbox
          checked={!hidden.has(row.key)}
          tooltip="Show this row in the viewport overlay"
          onChange={(on) => handleToggle(row.key, on)}
        />
      ),
    }));

  return (
    <div className="flex flex-col gap-2">
      {err && (
        <div className="flex flex-col gap-1 border border-red-900 bg-red-950/40 p-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[11px] text-red-300">GPU error</span>
            <CopyButton size="sm" className="ml-auto" value={err} />
          </div>
          <pre className="max-h-40 select-text overflow-auto whitespace-pre-wrap font-mono text-[11px] text-red-200">
            {err}
          </pre>
        </div>
      )}
      <PropertyList numeric labelWidth={132} rows={toRows(snap.rows)} />
      {snap.gpuRows.length > 0 && (
        <div className="flex flex-col gap-1 border-slate-800 border-t pt-1.5">
          <span className="font-medium text-[11px] text-slate-400">GPU pass times</span>
          <PropertyList numeric labelWidth={132} rows={toRows(snap.gpuRows)} />
        </div>
      )}
    </div>
  );
}
