import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { InfoBox } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { emitTreeSelect } from '../../../lib/treeSelectEvent';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { HierarchyMenu, type MenuState } from './HierarchyMenu';
import { HierarchyRows } from './HierarchyRows';
import { HierarchySearch, type SearchResult } from './HierarchySearch';
import { HierarchyToolbar } from './HierarchyToolbar';
import { groupKey } from './hierarchyModel';
import { useHierarchyTree } from './useHierarchyTree';
import { useRowSelection } from './useRowSelection';

/**
 * Lazy model hierarchy: rows exist only for expanded nodes; children are
 * fetched from the worker on first expand and cached. Clicking a row selects
 * its whole subtree; a viewport pick sets `reveal` and the tree expands to it.
 */
export function Hierarchy() {
  useMinSize(190, 120);
  const sel = selectionState.use();
  const tree = useHierarchyTree();
  const { select } = useRowSelection(tree.rows);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const pickResult = (r: SearchResult) => {
    if (r.model === -1 && r.group) {
      // folder result: expand every level down to it and select it
      const exp = new Set(tree.expandedRef.current);
      let p = '';
      for (const seg of r.group.split('/')) {
        p = p ? `${p}/${seg}` : seg;
        exp.add(groupKey(p));
      }
      tree.setExp(exp);
      void tree.rebuild(exp);
      void viewerActions.selectGroup(r.group);
      emitTreeSelect(-1, 0, r.group);
      return;
    }

    void viewerActions.selectSubtree(r.model, r.entry);
    selectionState.set({ reveal: { model: r.model, path: r.path } });
    emitTreeSelect(r.model, r.entry);
  };

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col overflow-hidden p-1 pr-2">
      <HierarchySearch onPick={pickResult} />
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
        <p className="note shrink-0">
          {sel.count.toLocaleString()} item{sel.count === 1 ? '' : 's'} selected
        </p>
      )}
      <HierarchyMenu menu={menu} rows={tree.rows} onClose={() => setMenu(null)} />
    </PanelBody>
  );
}
