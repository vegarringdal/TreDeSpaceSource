import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { InfoBox, Select, TextInput } from '@treDeSpaceUI/widgets';
import { useEffect, useMemo } from 'react';
import { sqlAssetsActions } from '../../../state/sqlAssets/sqlAssets.actions';
import { sqlAssetsState } from '../../../state/sqlAssets/sqlAssets.state';
import { sqlReportsActions as act } from '../../../state/sqlReports/sqlReports.actions';
import { sqlReportsState } from '../../../state/sqlReports/sqlReports.state';
import { storesActions } from '../../../state/stores/stores.actions';
import { storesState } from '../../../state/stores/stores.state';
import { NewReportRow } from './NewReportRow';
import { ReportEditor } from './ReportEditor';
import { ReportRow } from './ReportRow';

/** SQL Reports: saved queries a non-SQL user can run. Pick a STORE on top; the
 *  reports below are that store's (one SQL_Reports.json per store). Each report
 *  has type buttons; its SQL and main-db choice are only visible in the edit
 *  form. */
export function SqlReports() {
  useMinSize(300, 320);
  const { store, reports, query, editId } = sqlReportsState.use();
  const { dbs } = sqlAssetsState.use();
  const { stores } = storesState.use();

  useEffect(() => {
    // load the store registry + the db list; reports load once a store is picked
    void storesActions.init().then(() => sqlAssetsActions.refresh());
  }, []);

  const storeDbs = useMemo(() => dbs.filter((d) => d.store === store), [dbs, store]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return reports;
    }
    return reports.filter((r) => `${r.name} ${r.description}`.toLowerCase().includes(q));
  }, [reports, query]);

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
      <label className="flex shrink-0 items-center gap-2 text-slate-400 text-xs">
        <span className="w-12 shrink-0">Store</span>
        <div
          className="min-w-0 flex-1"
          data-tooltip="Reports are grouped by store — pick one to see and edit its reports"
        >
          <Select
            value={store}
            placeholder={stores.length ? 'Pick a store…' : 'No stores yet'}
            options={stores.map((s) => ({ value: s.name, label: s.name, hint: s.description || undefined }))}
            onChange={(v) => void act.setStore(v)}
          />
        </div>
      </label>

      {!store ? (
        <InfoBox>
          Select a store to see and create its reports. They are saved in that store's SQL_Reports.json.
        </InfoBox>
      ) : (
        <>
          <NewReportRow store={store} />
          <TextInput value={query} onChange={act.setQuery} placeholder="Search reports…" />
          {filtered.length === 0 ? (
            <p className="note px-1 py-2 text-center text-slate-500">
              {reports.length === 0 ? 'No reports yet — create one above.' : 'No reports match the search.'}
            </p>
          ) : (
            filtered.map((r) =>
              editId === r.id ? (
                <ReportEditor key={r.id} report={r} dbs={storeDbs} onClose={() => act.setEdit(null)} />
              ) : (
                <ReportRow key={r.id} report={r} />
              ),
            )
          )}
        </>
      )}
    </PanelBody>
  );
}
