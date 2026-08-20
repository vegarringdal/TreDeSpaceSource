import { InfoBox } from '@treDeSpaceUI/widgets';
import { parseAttachPaths } from '../../../lib/sqlite/sqlAttach';
import { sqlAssetsState } from '../../../state/sqlAssets/sqlAssets.state';
import { sqlEditorState } from '../../../state/sqlAssets/sqlEditor.state';

/** The editor's status footer: which files the next run will Web-Lock (main db
 *  + every ATTACH literal in the SQL, unknown paths in red) and the last run's
 *  outcome. */
export function SqlEditorStatus() {
  const { dbs } = sqlAssetsState.use();
  const { mainDbPath, sql, running, lastError, lastMs, lastRows } = sqlEditorState.use();

  const known = new Set(dbs.map((d) => d.path));
  const attached = parseAttachPaths(sql).filter((p) => p !== mainDbPath);
  const locked = [mainDbPath, ...attached].filter(Boolean);

  return (
    <>
      <div className="shrink-0 text-[11px] text-slate-500">
        Will lock:{' '}
        {locked.length === 0 ? (
          <span className="text-slate-600">nothing yet</span>
        ) : (
          locked.map((p, i) => (
            <span key={p} className={known.has(p) ? 'text-slate-400' : 'text-rose-400'}>
              {i > 0 && ', '}
              {p}
            </span>
          ))
        )}
      </div>
      {locked.some((p) => !known.has(p)) && (
        <InfoBox>
          A red path does not exist in SQL Assets yet — an exclusive run creates it, a shared (read-only) run fails.
        </InfoBox>
      )}
      <div className="shrink-0 text-[11px]">
        {running ? (
          <span className="text-amber-300">running…</span>
        ) : lastError ? (
          <span className="text-rose-400">{lastError}</span>
        ) : lastMs ? (
          <span className="text-slate-500">
            last run: {lastMs.toFixed(0)} ms, {lastRows} row(s) — see the Console panel
          </span>
        ) : (
          <span className="text-slate-600">ready</span>
        )}
      </div>
    </>
  );
}
