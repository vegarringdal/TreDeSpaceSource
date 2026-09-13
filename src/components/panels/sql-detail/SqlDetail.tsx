import { PanelBody, type PanelContext, useMinSize } from '@treDeSpaceUI/dockable';
import { Button, Checkbox, EmptyState, InfoBox, PanelHeader, PropertyList, TextInput } from '@treDeSpaceUI/widgets';
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
      <PanelBody className="panel-body flex h-full">
        <EmptyState layout="center">No report bound — click a report's Detail button in SQL Reports.</EmptyState>
      </PanelBody>
    );
  }

  const emptyMessage = hasRow
    ? filter.trim()
      ? 'No fields match the filter.'
      : 'All fields are empty.'
    : status || (listening ? 'Click an object in the viewport…' : 'Paused — enable Listening.');

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col overflow-hidden">
      <PanelHeader
        variant="title"
        className="p-2"
        title={report.name}
        actions={
          <>
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
          </>
        }
      />
      {/* fixed toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-slate-800 border-b p-2">
        <div className="min-w-0 flex-1">
          <TextInput type="search" value={filter} onChange={setFilter} placeholder="Filter fields…" />
        </div>
        <Checkbox
          label="Hide empty"
          checked={hideEmpty}
          onChange={setHideEmpty}
          tooltip="Hide fields whose value is null or empty"
        />
      </div>

      {/* scrollable fields */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hasRow && fields.length > 0 ? (
          <PropertyList
            divided
            rows={fields.map((f) => ({
              key: f.key,
              label: f.label,
              tooltip: f.label === f.col ? f.col : `${f.col}: ${f.label}`,
              value: <DetailValue field={f} />,
            }))}
          />
        ) : (
          <EmptyState layout="center">{emptyMessage}</EmptyState>
        )}
      </div>
      {hasRow && status && (
        <InfoBox tone="danger" className="shrink-0 border-x-0 border-b-0">
          {status}
        </InfoBox>
      )}
    </PanelBody>
  );
}
