import { useEffect, useMemo, useState } from 'react';
import { sqlReportsActions } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';

type DetailField = Readonly<{ col: string; val: unknown; key: string }>;

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

/** Viewport-click-driven state for the SQL Detail panel: while listening, each
 *  pick rebuilds TREE_VIEW_ARGS from the clicked item's fullname hierarchy,
 *  re-runs the bound report's LIMIT 1 query, and exposes the row as field
 *  entries filtered by the text filter and the hide-empty toggle. */
export function useSqlDetailForm(report: ReportDef | null): SqlDetailForm {
  const [listening, setListening] = useState(true);
  const [form, setForm] = useState<{ columns: string[]; row: unknown[] } | null>(null);
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);

  // (Re)bind: follow the report OBJECT, not its id — the SQL Editor binds a
  // fresh report under the same id ('__editor__') every time, and a saved
  // report re-bound after an edit is a new object too; keying on the id kept
  // the click handler running the OLD SQL. The form follows the SELECTION
  // (tree click, viewport pick, U / P, API — anything that moves the
  // selection root), not just viewport picks, and re-runs the current
  // selection on rebind so the new query answers without another click.
  useEffect(() => {
    setForm(null);
    setStatus('');
    if (!report || !listening) {
      return;
    }
    let alive = true;
    let lastKey = '';
    const run = async () => {
      const tree = await viewerActions.lastSelectedTree();
      if (!tree.length || !alive) {
        return;
      }
      setStatus('running…');
      const res = await sqlReportsActions.runDetail(report, tree);
      if (!alive) {
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
        setStatus('no match');
      }
    };
    const keyOf = () => {
      const { active, activeGroup } = selectionState.get();
      return active ? `${active.model}:${active.entry}` : (activeGroup ?? '');
    };
    lastKey = keyOf();
    void run();
    const off = selectionState.subscribe(() => {
      const k = keyOf();
      if (k && k !== lastKey) {
        lastKey = k;
        void run();
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [report, listening]);

  // fields in SELECT order, with the current filter + hide-empty applied
  const fields = useMemo(() => {
    if (!form) {
      return [];
    }
    const q = filter.trim().toLowerCase();
    return form.columns
      .map((col, i) => ({ col, val: form.row[i], key: `${i}:${col}` }))
      .filter((f) => !(hideEmpty && (f.val == null || f.val === '')))
      .filter(
        (f) =>
          !q ||
          f.col.toLowerCase().includes(q) ||
          String(f.val ?? '')
            .toLowerCase()
            .includes(q),
      );
  }, [form, filter, hideEmpty]);

  const toggleListening = () => setListening((v) => !v);

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
