import { useRef } from 'react';
import { filesUnder, type TreeRow } from './fileTreeModel';

/**
 * Desktop-file-manager selection: click = select one, Ctrl+click = toggle,
 * Shift+click = range over the VISIBLE rows; a folder row selects/toggles its
 * whole subtree.
 */
export function useFileTreeSelection(
  selected: Set<string>,
  onSelect: (next: Set<string>) => void,
  visibleFiles: string[],
): { click: (row: TreeRow, e: React.MouseEvent) => void } {
  const anchor = useRef<string | null>(null);

  const click = (row: TreeRow, e: React.MouseEvent) => {
    const n = row.node;
    if (n.kind === 'dir') {
      // the ROW selects the folder's subtree — expansion is the chevron's job
      const files = filesUnder(n).map((f) => f.path);
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(selected);
        const allIn = files.length > 0 && files.every((f) => next.has(f));
        for (const f of files) {
          if (allIn) {
            next.delete(f);
          } else {
            next.add(f);
          }
        }
        onSelect(next);
      } else {
        onSelect(new Set(files));
      }
      return;
    }

    if (e.shiftKey && anchor.current != null) {
      const a = visibleFiles.indexOf(anchor.current);
      const b = visibleFiles.indexOf(n.path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const next = e.ctrlKey || e.metaKey ? new Set(selected) : new Set<string>();
        for (let i = lo; i <= hi; i++) {
          next.add(visibleFiles[i]);
        }
        onSelect(next);
        return;
      }
    }

    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(n.path)) {
        next.delete(n.path);
      } else {
        next.add(n.path);
      }
      anchor.current = n.path;
      onSelect(next);
      return;
    }

    anchor.current = n.path;
    onSelect(new Set([n.path]));
  };

  return { click };
}
