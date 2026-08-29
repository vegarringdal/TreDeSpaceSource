import { useEffect } from 'react';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import type { Row } from './hierarchyModel';

export type MenuState = { x: number; y: number; row: Row };

/** Right-click menu: copy names and remove files/folders. Closes on any
 *  outside pointer press. */
export function HierarchyMenu({ menu, rows, onClose }: { menu: MenuState | null; rows: Row[]; onClose: () => void }) {
  useEffect(() => {
    if (!menu) {
      return;
    }
    window.addEventListener('pointerdown', onClose);
    return () => window.removeEventListener('pointerdown', onClose);
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }

  const visibleSelected = () => rows.filter((r) => r.selected && r.model !== -1);

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    onClose();
  };

  /** Remove the row's whole file (any item row → its model) or folder subtree. */
  const removeCurrent = (r: Row) => {
    onClose();
    if (r.model === -1) {
      void viewerActions.removeGroups([r.group!], `folder "${r.group}"`, r.inStore);
    } else {
      void viewerActions.removeModels([r.model]);
    }
  };

  const setItemEdges = (on: boolean) => {
    onClose();
    void viewerActions.setItemEdgesOnSelection(on);
  };

  /** Remove every file that owns a selected row (distinct models). */
  const removeSelected = () => {
    onClose();
    const models = [...new Set(visibleSelected().map((r) => r.model))];
    void viewerActions.removeModels(models);
  };

  return (
    <div
      className="fixed z-50 flex flex-col border border-slate-700 bg-slate-900 py-1 text-xs shadow-lg"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="px-3 py-1 text-left text-slate-200 hover:bg-slate-800"
        onClick={() => copy(menu.row.name)}
      >
        Copy Current
      </button>
      <button
        type="button"
        className="px-3 py-1 text-left text-slate-200 hover:bg-slate-800"
        onClick={() =>
          copy(
            visibleSelected()
              .map((r) => r.name)
              .join('\n'),
          )
        }
      >
        Copy Selected
      </button>
      <button
        type="button"
        className="px-3 py-1 text-left text-slate-200 hover:bg-slate-800"
        onClick={() =>
          copy(
            visibleSelected()
              .filter((r) => r.depth === menu.row.depth)
              .map((r) => r.name)
              .join('\n'),
          )
        }
      >
        Copy Selected same level
      </button>
      <div className="my-1 border-slate-700 border-t" />
      <button
        type="button"
        className="px-3 py-1 text-left text-slate-200 hover:bg-slate-800"
        data-shortcut="hierarchy.itemEdgesOff"
        data-tooltip="No item-boundary edge lines on the selected items (only visible while Settings → Edges → item edges is on). Undo reverts it"
        onClick={() => setItemEdges(false)}
      >
        Disable item edges on selected
      </button>
      <button
        type="button"
        className="px-3 py-1 text-left text-slate-200 hover:bg-slate-800"
        data-shortcut="hierarchy.itemEdgesOn"
        data-tooltip="Item-boundary edge lines back on for the selected items"
        onClick={() => setItemEdges(true)}
      >
        Enable item edges on selected
      </button>
      <div className="my-1 border-slate-700 border-t" />
      <button
        type="button"
        className="px-3 py-1 text-left text-red-300 hover:bg-slate-800"
        onClick={() => removeCurrent(menu.row)}
      >
        Remove current file/folder
      </button>
      <button type="button" className="px-3 py-1 text-left text-red-300 hover:bg-slate-800" onClick={removeSelected}>
        Remove selected files
      </button>
    </div>
  );
}
