import type { MouseEvent as ReactMouseEvent } from 'react';
import { useRef } from 'react';
import { emitTreeSelect } from '../../../lib/treeSelectEvent';
import { db } from '../../../state/viewer/db';
import { groupSelKey, selectionState } from '../../../state/viewer/selection.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { keyOf, type Row } from './hierarchyModel';

/** Click/Ctrl/Shift selection over the visible rows: plain click selects the
 *  subtree (or group), Ctrl toggles, Shift adds the whole anchor→click range —
 *  folder rows in a range expand to the root entries of their group subtree. */
export function useRowSelection(rows: Row[]): { select: (r: Row, e: ReactMouseEvent) => void } {
  const lastClickIdx = useRef(-1);

  const addRange = async (idx: number) => {
    const [a, b] = [Math.min(lastClickIdx.current, idx), Math.max(lastClickIdx.current, idx)];
    const pairs: { model: number; entry: number }[] = [];
    const seen = new Set<string>();
    const groups: string[] = [];
    for (const x of rows.slice(a, b + 1)) {
      if (x.store != null) {
        continue; // store bands are chrome, not content
      }
      if (x.model === -1) {
        groups.push(groupSelKey(x.group!, x.inStore));
      }
      const expand =
        x.model === -1 ? await db.groupRootEntries(x.group!, x.inStore) : [{ model: x.model, entry: x.entry }];
      for (const p of expand) {
        const k = keyOf(p.model, p.entry);
        if (!seen.has(k)) {
          seen.add(k);
          pairs.push(p);
        }
      }
    }
    await viewerActions.addSubtrees(pairs);
    if (groups.length) {
      selectionState.set((p) => ({ activeGroups: [...new Set([...p.activeGroups, ...groups])] }));
    }
  };

  const select = (r: Row, e: ReactMouseEvent) => {
    const idx = rows.indexOf(r);
    if (e.ctrlKey || e.metaKey) {
      if (r.model === -1) {
        void viewerActions.toggleGroup(r.group!, r.inStore);
      } else {
        void viewerActions.toggleSubtree(r.model, r.entry);
      }
    } else if (e.shiftKey && lastClickIdx.current >= 0) {
      void addRange(idx);
    } else if (r.model === -1) {
      void viewerActions.selectGroup(r.group!, r.inStore);
    } else {
      void viewerActions.selectSubtree(r.model, r.entry);
    }
    lastClickIdx.current = idx;
    emitTreeSelect(r.model, r.entry, r.group);
  };

  return { select };
}
