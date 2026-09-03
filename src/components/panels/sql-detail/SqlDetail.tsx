import { PanelBody, type PanelContext, useMinSize } from '@treDeSpaceUI/dockable';
import { Button, TextInput } from '@treDeSpaceUI/widgets';
import { useCallback, useSyncExternalStore } from 'react';
import { DetailValue } from './DetailValue';
import {
  detailKeyOf,
  getDetailAutoRemove,
  getDetailReport,
  setDetailAutoRemove,
  subscribeDetailReport,
} from './sqlDetailPanel';
import { useSqlDetailForm } from './useSqlDetailForm';

/** SQL Detail: bound to a DETAIL report. While Listening, every tree select
 *  (viewport click, tree click, U / P — repeats included) and every API
 *  selection rebuilds TREE_VIEW_ARGS from that node's tree-view path, re-runs
 *  the report's query, and shows the first row as a two-column field list —
 *  a JSON-array column flattened to one field per element, http(s) values as
 *  links (see detailFields.ts). The header + toolbar are fixed; only the
 *  fields scroll. */
export function SqlDetail({ ctx }: { ctx: PanelContext }) {
  useMinSize(260, 200);
  // one component serves every detail panel: the panel id carries which
  // binding this instance shows (built-in, or a host-named one)
  const key = detailKeyOf(ctx.id);
  const snapshot = useCallback(() => getDetailReport(key), [key]);
  const report = useSyncExternalStore(subscribeDetailReport, snapshot);
  const autoRemoveSnapshot = useCallback(() => getDetailAutoRemove(key), [key]);
  const autoRemove = useSyncExternalStore(subscribeDetailReport, autoRemoveSnapshot);
  const { listening, toggleListening, hasRow, fields, status, filter, setFilter, hideEmpty, setHideEmpty } =
    useSqlDetailForm(report, key);

  if (!report) {
    return (
      <PanelBody className="panel-body flex h-full items-center justify-center p-4 text-slate-500 text-xs">
        No report bound — click a report's Detail button in SQL Reports.
      </PanelBody>
    );
  }

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col overflow-hidden">
      {/* fixed header */}
      <div className="flex shrink-0 items-center gap-2 border-slate-800 border-b p-2">
        <span className="flex-1 truncate font-medium text-slate-200 text-xs">{report.name}</span>
        <Button
          active={listening}
          shortcut="sql.detail.listen"
          tooltip="Follow the selection — every tree click, viewport pick, U / P or API selection fills this form from that node"
          onClick={toggleListening}
        >
          {listening ? 'Listening' : 'Paused'}
        </Button>
        {key !== '' && (
          <Button
            active={!autoRemove}
            tooltip={
              autoRemove
                ? 'Auto-remove is ON: closing this panel deletes it and its query. Click to KEEP it instead — it can then be reopened from the Panels list with its query intact.'
                : 'Keep is ON: closing this panel leaves it in the Panels list with its query. Click to auto-remove it on close instead.'
            }
            onClick={() => setDetailAutoRemove(key, !autoRemove)}
          >
            {autoRemove ? 'Auto-remove' : 'Keep'}
          </Button>
        )}
      </div>
      {/* fixed toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-slate-800 border-b p-2">
        <div className="min-w-0 flex-1">
          <TextInput value={filter} onChange={setFilter} placeholder="Filter fields…" />
        </div>
        <label
          className="flex shrink-0 cursor-pointer items-center gap-1.5 text-slate-300 text-xs"
          data-tooltip="Hide fields whose value is null or empty"
        >
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide empty
        </label>
      </div>

      {/* scrollable fields */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hasRow && fields.length > 0 ? (
          <dl className="flex flex-col text-xs">
            {fields.map((f) => (
              <div key={f.key} className="flex gap-2 border-slate-800 border-b px-2 py-1">
                <dt
                  className="w-32 shrink-0 truncate text-slate-400"
                  title={f.label === f.col ? f.col : `${f.col}: ${f.label}`}
                >
                  {f.label}
                </dt>
                <dd className="min-w-0 flex-1 break-words text-slate-200">
                  <DetailValue field={f} />
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="note px-2 py-3 text-center text-slate-500">
            {hasRow
              ? filter.trim()
                ? 'No fields match the filter.'
                : 'All fields are empty.'
              : status || (listening ? 'Click an object in the viewport…' : 'Paused — enable Listening.')}
          </p>
        )}
      </div>
      {hasRow && status && <p className="shrink-0 border-slate-800 border-t p-2 text-rose-400 text-xs">{status}</p>}
    </PanelBody>
  );
}
