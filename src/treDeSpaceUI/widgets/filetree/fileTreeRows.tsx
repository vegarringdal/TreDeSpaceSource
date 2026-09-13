import { IconFolder } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import type { TreeViewRow } from '../tree/TreeView';
import { filesUnder, type TreeRow } from './fileTreeModel';

/** Map the file model's visible rows onto the generic tree's row shape. The
 *  tree owns indent, twisty and highlighting; this decides what a file row
 *  looks like (icon, note, folder count) and when a folder counts as selected
 *  — when every file under it is. */
export function toTreeRows(
  rows: readonly TreeRow[],
  selected: ReadonlySet<string>,
  collapsed: ReadonlySet<string>,
  expandAll: boolean,
  fileIcon: ReactNode,
): TreeViewRow[] {
  return rows.map((r) => {
    const n = r.node;
    if (n.kind === 'file') {
      return {
        key: n.path || n.name,
        depth: r.depth,
        label: n.name,
        icon: <span className="flex shrink-0">{fileIcon}</span>,
        selected: selected.has(n.path),
        trailing: n.note != null ? <span className="text-[10px] text-slate-500">{n.note}</span> : undefined,
      };
    }
    const files = filesUnder(n);
    return {
      key: n.path || n.name,
      depth: r.depth,
      label: n.name,
      icon: n.icon ?? <IconFolder size={13} className="shrink-0 text-slate-400" />,
      expandable: true,
      expanded: expandAll || !collapsed.has(n.path),
      selected: files.length > 0 && files.every((f) => selected.has(f.path)),
      band: n.variant === 'section',
      trailing: <span className="text-[10px] text-slate-500">{files.length}</span>,
    };
  });
}
