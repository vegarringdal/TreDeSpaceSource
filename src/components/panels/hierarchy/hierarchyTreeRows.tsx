import { IconCube, IconDatabase, IconFolder } from '@tabler/icons-react';
import type { TreeViewRow } from '@treDeSpaceUI/widgets';
import { HiddenBadge } from './HiddenBadge';
import { type Row, rowKey } from './hierarchyModel';

const PARTIAL_TOOLTIP =
  'Partly selected: some of the items below this row are selected (not all). The row highlights fully once everything beneath it is selected — no need to expand to see where the selection is';

/** Icon for a row: folder rows get the folder, a model file's root entry the
 *  bright cube, and deeper entries a dark cube so every level indents alike. */
function iconOf(r: Row) {
  if (r.model === -1) {
    return <IconFolder size={14} className="shrink-0 text-amber-400/80" />;
  }
  return <IconCube size={14} className={`shrink-0 ${r.isRoot ? 'text-sky-400/80' : 'text-slate-600'}`} />;
}

/** Map the hierarchy model's rows onto the generic tree's row shape. Store
 *  (plant) bands are grouping chrome only — not collapsible, not selectable,
 *  and they add no hierarchy level. */
export function toTreeRows(rows: readonly Row[], expanded: ReadonlySet<string>): TreeViewRow[] {
  return rows.map((r) => {
    if (r.store != null) {
      return {
        key: `s:${r.store}`,
        depth: 0,
        label: r.name,
        icon: <IconDatabase size={12} className="shrink-0" />,
        band: true,
        disabled: true,
        trailing: <HiddenBadge hidden={r.hidden} />,
      };
    }
    const k = rowKey(r);
    return {
      key: k,
      depth: r.depth,
      label: r.name,
      icon: iconOf(r),
      expandable: r.hasChildren,
      expanded: expanded.has(k),
      selected: r.selected,
      partial: r.partial,
      partialTooltip: PARTIAL_TOOLTIP,
      muted: r.hidden === 'all',
      trailing: <HiddenBadge hidden={r.hidden} />,
    };
  });
}
