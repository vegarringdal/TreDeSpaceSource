import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { InfoBox } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { selectionState } from '../../../state/viewer/selection.state';
import { HierarchyMenu, type MenuState } from './HierarchyMenu';
import { HierarchyRows } from './HierarchyRows';
import { HierarchySearch } from './HierarchySearch';
import { HierarchyToolbar } from './HierarchyToolbar';
import { useHierarchyTree } from './useHierarchyTree';
import { useRowSelection } from './useRowSelection';
import { useSearchPick } from './useSearchPick';

/**
 * Lazy model hierarchy: rows exist only for expanded nodes; children are
 * fetched from the worker on first expand and cached. Clicking a row selects
 * its whole subtree; a viewport pick or a search result sets `reveal` and the
 * tree expands to it.
 */
export function Hierarchy() {
  useMinSize(190, 120);
  const sel = selectionState.use();
  const tree = useHierarchyTree();
  const { select } = useRowSelection(tree.rows);
  const { pick } = useSearchPick(tree);
  const [menu, setMenu] = useState<MenuState | null>(null);

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col overflow-hidden p-1 pr-2">
      <HierarchySearch onPick={pick} />
      <HierarchyToolbar expandedCount={tree.expanded.size} onCollapseAll={tree.collapseAll} />
      {tree.rows.length === 0 && (
        <InfoBox>Load models from the Assets panel (Home → Assets → Model or Import) to see the tree.</InfoBox>
      )}
      <HierarchyRows
        rows={tree.rows}
        expanded={tree.expanded}
        listRef={tree.listRef}
        onToggle={tree.toggle}
        onSelect={select}
        onContextMenu={(r, e) => setMenu({ x: e.clientX, y: e.clientY, row: r })}
      />
      {sel.count > 0 && (
        <p className="m-0 mt-2 shrink-0 text-slate-400 text-xs">
          {sel.count.toLocaleString()} item{sel.count === 1 ? '' : 's'} selected
        </p>
      )}
      <HierarchyMenu menu={menu} rows={tree.rows} onClose={() => setMenu(null)} />
    </PanelBody>
  );
}
