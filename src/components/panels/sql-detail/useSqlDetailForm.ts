import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { onTreeSelect } from '../../../lib/treeSelectEvent';
import { sqlReportsActions } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { buildDetailFields, type DetailField, isEmptyValue, matchesFilter } from './detailFields';
import { getDetailListening, setDetailListening, subscribeDetailReport } from './sqlDetailPanel';

type SqlDetailForm = Readonly<{
  listening: boolean;
  toggleListening: () => void;
  hasRow: boolean;
  fields: DetailField[];
  status: string;
  filter: string;
  setFilter: (x: string) => void;
  hideEmpty: boolean;
  setHideEmpty: (x: boolean) => void;
}>;

/** The store's counterpart of a tree-select key: the active item as
 *  `model:entry`, else the active group path (its store qualifier dropped —
 *  a click reports the plain path). Empty when nothing is selected. */
function selectionKey(): string {
  const { active, activeGroup } = selectionState.get();
  if (active) {
    return `${active.model}:${active.entry}`;
  }
  return activeGroup?.split('\0').pop() ?? '';
}

/** Click-driven state for a SQL Detail panel. While Listening, EVERY tree
 *  select (tree row, viewport pick, U / P, digit+click — a repeat of the
 *  current node included) runs the bound report's DETAIL query against that
 *  node's tree-view path the moment the click resolves, the way a host on
 *  `tree.select` would. Selections that arrive without a click (the API's
 *  selection.set / sql.select) reach it through the selection store instead.
 *  The row shows as field entries filtered by the text filter and the
 *  hide-empty toggle. */
export function useSqlDetailForm(report: ReportDef | null, key: string): SqlDetailForm {
  const listeningSnapshot = useCallback(() => getDetailListening(key), [key]);
  const listening = useSyncExternalStore(subscribeDetailReport, listeningSnapshot);
  const [form, setForm] = useState<{ columns: string[]; row: unknown[] } | null>(null);
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);

  // (Re)bind: follow the report OBJECT, not its id — the SQL Editor binds a
  // fresh report under the same id ('__editor__') every time, and a saved
  // report re-bound after an edit is a new object too; keying on the id kept
  // the click handler running the OLD SQL. A rebind re-runs the current
  // selection so the new query answers without another click.
  useEffect(() => {
    setForm(null);
    setStatus('');
    if (!report || !listening) {
      return;
    }
    let alive = true;
    // Only the LATEST run may touch the form: two quick clicks can complete out
    // of order (the SQL worker opens handles asynchronously), and a slow first
    // query must not overwrite the row of the click that came after it.
    let seq = 0;
    const run = async (source: string[] | Promise<string[]>) => {
      const mine = ++seq;
      const tree = await source;
      if (!alive || mine !== seq || !tree.length) {
        return;
      }
      setStatus('running…');
      const res = await sqlReportsActions.runDetail(report, tree);
      if (!alive || mine !== seq) {
        return;
      }
      if (res.error) {
        setStatus(res.error);
        setForm(null);
      } else if (res.rows.length) {
        setForm({ columns: res.columns, row: res.rows[0] });
        setStatus('');
      } else {
        setForm(null);
        setStatus(`No data found for ${tree[tree.length - 1]}`);
      }
    };
    // Two keys keep one click from running twice: the click's own event runs
    // first and records what it ran, then the selection store settles on the
    // same node and is skipped. An API selection never fires the click event,
    // so it reaches run() through the store alone.
    let lastClickKey = '';
    let lastStoreKey = selectionKey();
    void run(viewerActions.lastSelectedTree());
    const offClick = onTreeSelect((e) => {
      lastClickKey = e.key;
      void run(e.tree);
    });
    const offStore = selectionState.subscribe(() => {
      const k = selectionKey();
      if (!k || k === lastStoreKey) {
        return;
      }
      lastStoreKey = k;
      if (k === lastClickKey) {
        return;
      }
      void run(viewerActions.lastSelectedTree());
    });
    return () => {
      alive = false;
      offClick();
      offStore();
    };
  }, [report, listening]);

  // fields in SELECT order (JSON-array columns flattened), with the current
  // filter + hide-empty applied
  const fields = useMemo(() => {
    if (!form) {
      return [];
    }
    const q = filter.trim().toLowerCase();
    return buildDetailFields(form.columns, form.row)
      .filter((f) => !(hideEmpty && isEmptyValue(f.val)))
      .filter((f) => matchesFilter(f, q));
  }, [form, filter, hideEmpty]);

  const toggleListening = () => setDetailListening(key, !listening);

  return {
    listening,
    toggleListening,
    hasRow: form !== null,
    fields,
    status,
    filter,
    setFilter,
    hideEmpty,
    setHideEmpty,
  };
}
