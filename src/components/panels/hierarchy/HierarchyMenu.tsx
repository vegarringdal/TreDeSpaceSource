import { Menu, type MenuEntry } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import type { Row } from './hierarchyModel';

export type MenuState = { x: number; y: number; row: Row };

/** Right-click menu: copy names, toggle item edges and remove files/folders. */
export function HierarchyMenu({ menu, rows, onClose }: { menu: MenuState | null; rows: Row[]; onClose: () => void }) {
  const visibleSelected = () => rows.filter((r) => r.selected && r.model !== -1);

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  /** Remove the row's whole file (any item row → its model) or folder subtree. */
  const removeCurrent = (r: Row) => {
    if (r.model === -1) {
      void viewerActions.removeGroups([r.group!], `folder "${r.group}"`, r.inStore);
    } else {
      void viewerActions.removeModels([r.model]);
    }
  };

  /** Remove every file that owns a selected row (distinct models). */
  const removeSelected = () => {
    const models = [...new Set(visibleSelected().map((r) => r.model))];
    void viewerActions.removeModels(models);
  };

  const items = (row: Row): MenuEntry[] => [
    { id: 'copyCurrent', label: 'Copy Current', onSelect: () => copy(row.name) },
    {
      id: 'copySelected',
      label: 'Copy Selected',
      onSelect: () =>
        copy(
          visibleSelected()
            .map((r) => r.name)
            .join('\n'),
        ),
    },
    {
      id: 'copySelectedLevel',
      label: 'Copy Selected same level',
      onSelect: () =>
        copy(
          visibleSelected()
            .filter((r) => r.depth === row.depth)
            .map((r) => r.name)
            .join('\n'),
        ),
    },
    { separator: true },
    {
      id: 'itemEdgesOff',
      label: 'Disable item edges on selected',
      shortcut: 'hierarchy.itemEdgesOff',
      tooltip:
        'No item-boundary edge lines on the selected items (only visible while Settings → Edges → item edges is on). Undo reverts it',
      onSelect: () => void viewerActions.setItemEdgesOnSelection(false),
    },
    {
      id: 'itemEdgesOn',
      label: 'Enable item edges on selected',
      shortcut: 'hierarchy.itemEdgesOn',
      tooltip: 'Item-boundary edge lines back on for the selected items',
      onSelect: () => void viewerActions.setItemEdgesOnSelection(true),
    },
    { separator: true },
    { id: 'removeCurrent', label: 'Remove current file/folder', danger: true, onSelect: () => removeCurrent(row) },
    { id: 'removeSelected', label: 'Remove selected files', danger: true, onSelect: removeSelected },
  ];

  return <Menu anchor={menu} items={menu ? items(menu.row) : []} minWidth={200} onClose={onClose} />;
}
