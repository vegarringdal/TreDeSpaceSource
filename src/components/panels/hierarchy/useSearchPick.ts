import { emitTreeSelect } from '../../../lib/treeSelectEvent';
import { selectionState } from '../../../state/viewer/selection.state';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { groupKey } from './hierarchyModel';
import type { SearchResult } from './useHierarchySearch';
import type { HierarchyTree } from './useHierarchyTree';

/** Search-result clicks. A plain click replaces the selection; `additive`
 *  (Ctrl/⌘) toggles the row in or out, like Ctrl on a tree row. Either way the
 *  tree expands and scrolls to the row. A one-per-name row standing for
 *  several entries selects (additive: adds) EVERY entry with that name and
 *  reveals only the copy the list shows. */
export function useSearchPick(tree: HierarchyTree): { pick: (r: SearchResult, additive: boolean) => void } {
  // -----------------------------------------------------------------------------
  // Helper functions
  // -----------------------------------------------------------------------------

  const expandToFolder = (group: string): void => {
    const exp = new Set(tree.expandedRef.current);
    let p = '';
    for (const seg of group.split('/')) {
      p = p ? `${p}/${seg}` : seg;
      exp.add(groupKey(p));
    }
    tree.setExp(exp);
    void tree.rebuild(exp);
  };

  const pickFolder = (group: string, additive: boolean): void => {
    expandToFolder(group);
    void (additive ? viewerActions.toggleGroup(group) : viewerActions.selectGroup(group));
    emitTreeSelect(-1, 0, group);
  };

  const pickAllNamed = (r: SearchResult, additive: boolean): void => {
    void viewerActions.selectByFullnames([r.name], { append: additive, focus: { model: r.model, entry: r.entry } });
    emitTreeSelect(r.model, r.entry);
  };

  const pickEntry = (r: SearchResult, additive: boolean): void => {
    void (additive ? viewerActions.toggleSubtree(r.model, r.entry) : viewerActions.selectSubtree(r.model, r.entry));
    selectionState.set({ reveal: { model: r.model, path: r.path } });
    emitTreeSelect(r.model, r.entry);
  };

  // -----------------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------------

  const pick = (r: SearchResult, additive: boolean): void => {
    if (r.model === -1 && r.group) {
      pickFolder(r.group, additive);
      return;
    }

    if ((r.count ?? 1) > 1) {
      pickAllNamed(r, additive);
      return;
    }

    pickEntry(r, additive);
  };

  return { pick };
}
