import { useEffect, useMemo, useState } from 'react';
import { sqlReportsActions } from '../../../state/sqlReports/sqlReports.actions';
import type { ReportDef } from '../../../state/sqlReports/sqlReports.state';
import { db } from '../../../state/viewer/db';
import { onViewportPick } from '../../../state/viewer/pickListeners';

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-subscribe when the bound report OR listening changes
  useEffect(() => {
    if (!report || !listening) {
      return;
    }
    return onViewportPick(({ model, item }) => {
      void (async () => {
        const tree = await db.itemFullnamePath(model, item);
        if (!tree.length) {
          return;
        }
        setStatus('running…');
        const res = await sqlReportsActions.runDetail(report, tree);
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
      })();
    });
  }, [report?.id, listening]);

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
