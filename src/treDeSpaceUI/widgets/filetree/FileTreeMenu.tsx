import { createPortal } from 'react-dom';

export type FileTreeMenuState = {
  x: number;
  y: number;
  dirPath: string | null;
  /** The row is a section band — grouping chrome, so no rename/delete. */
  section?: boolean;
};

/** Right-click folder menu, body-portaled so tree scroll clipping can't cut
 *  it off. */
export function FileTreeMenu({
  menu,
  onClose,
  onAddFolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  menu: FileTreeMenuState;
  onClose: () => void;
  onAddFolder: (parentDirPath: string | null) => void;
  onRenameFolder?: (dirPath: string) => void;
  onDeleteFolder?: (dirPath: string) => void;
}) {
  return createPortal(
    <div
      className="fixed z-[3000] flex min-w-36 flex-col border border-slate-700 bg-slate-800 shadow-black/50 shadow-lg"
      style={{ left: Math.min(menu.x, window.innerWidth - 160), top: Math.min(menu.y, window.innerHeight - 90) }}
      onMouseLeave={onClose}
    >
      <button
        type="button"
        className="px-3 py-1 text-left text-slate-200 text-xs hover:bg-slate-700"
        onClick={() => {
          onAddFolder(menu.dirPath);
          onClose();
        }}
      >
        {menu.dirPath != null ? 'New folder inside…' : 'New folder…'}
      </button>
      {menu.dirPath != null && !menu.section && onRenameFolder && (
        <button
          type="button"
          className="px-3 py-1 text-left text-slate-200 text-xs hover:bg-slate-700"
          onClick={() => {
            const d = menu.dirPath;
            onClose();
            if (d != null) {
              onRenameFolder(d);
            }
          }}
        >
          Rename folder…
        </button>
      )}
      {menu.dirPath != null && !menu.section && onDeleteFolder && (
        <button
          type="button"
          className="px-3 py-1 text-left text-red-300 text-xs hover:bg-slate-700"
          onClick={() => {
            const d = menu.dirPath;
            onClose();
            if (d != null) {
              onDeleteFolder(d);
            }
          }}
        >
          Delete folder…
        </button>
      )}
    </div>,
    document.body,
  );
}
