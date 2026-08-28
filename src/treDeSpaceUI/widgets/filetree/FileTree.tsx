// A file-tree picker. Multi-select like a desktop file manager: click =
// select one, Ctrl+click = toggle, Shift+click = range over the VISIBLE rows,
// folder chevron = toggle expansion, folder Ctrl/plain click selects/deselects
// everything under it. Optional drag-and-drop moves and a right-click folder
// menu — see FileTreeProps.
import { IconFile3d } from '@tabler/icons-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { FileTreeMenu, type FileTreeMenuState } from './FileTreeMenu';
import { FileTreeRow } from './FileTreeRow';
import { dirPaths, type TreeDir, visibleRows } from './fileTreeModel';
import { useFileTreeSelection } from './useFileTreeSelection';

export type { TreeDir, TreeFile, TreeNode } from './fileTreeModel';

export interface FileTreeProps {
  root: TreeDir;
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  onMove?: (paths: string[], dirPath: string) => void;
  onAddFolder?: (parentDirPath: string | null) => void;
  /** Right-click a folder → Rename (dirPath is the row's path). */
  onRenameFolder?: (dirPath: string) => void;
  /** Right-click a folder → Delete (empty folders vanish; files get ungrouped). */
  onDeleteFolder?: (dirPath: string) => void;
  /** Drag a folder row onto another folder (or the root gap). */
  onMoveFolder?: (dirPath: string, targetDirPath: string) => void;
  /** Shown when the tree has no rows. */
  emptyText?: string;
  /** Per-row file icon (locked to 13px by the caller's choice of icon). */
  fileIcon?: ReactNode;
  /** Dir paths that start collapsed (initial state only — re-applied when the
   *  component remounts, e.g. via a `key` change). */
  defaultCollapsed?: readonly string[];
  /** Render every dir expanded regardless of collapse state (e.g. while a
   *  search filter is active); the stored state returns when turned off. */
  expandAll?: boolean;
  /** Bump to collapse every directory (a counter the parent increments — a
   *  toolbar button or hotkey; the tree keeps owning the per-dir state). */
  collapseAllSignal?: number;
  /** Bump to expand every directory. */
  expandAllSignal?: number;
  /** Overrides the default max-h-64 scroll box (e.g. `min-h-0 flex-1` to fill). */
  className?: string;
}

/** Controlled tree: `selected` is a set of file paths owned by the parent.
 *  Optional extras: `onMove` enables dragging the selected files onto a folder
 *  (or the root gap) and `onAddFolder` adds a right-click → New folder menu. */
export function FileTree({
  root,
  selected,
  onSelect,
  onMove,
  onAddFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  emptyText = 'No files found.',
  fileIcon = <IconFile3d size={13} className="shrink-0 text-slate-400" />,
  defaultCollapsed,
  expandAll = false,
  collapseAllSignal,
  expandAllSignal,
  className,
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(defaultCollapsed));
  // the signals are edge-triggered: only a CHANGE acts, so a remount with the
  // same counter value (e.g. a `key` change) keeps `defaultCollapsed`
  const lastSignal = useRef({ collapse: collapseAllSignal, expand: expandAllSignal });
  useEffect(() => {
    if (collapseAllSignal !== lastSignal.current.collapse) {
      lastSignal.current.collapse = collapseAllSignal;
      setCollapsed(new Set(dirPaths(root)));
    }
  }, [collapseAllSignal, root]);
  useEffect(() => {
    if (expandAllSignal !== lastSignal.current.expand) {
      lastSignal.current.expand = expandAllSignal;
      setCollapsed(new Set());
    }
  }, [expandAllSignal]);
  const [dropDir, setDropDir] = useState<string | null>(null);
  const [menu, setMenu] = useState<FileTreeMenuState | null>(null);

  /** Paths that travel in a drag: the whole selection when dragging a selected
   *  row, else just the dragged row. */
  const dragPaths = (path: string): string[] => (selected.has(path) ? [...selected] : [path]);

  const rows = useMemo(() => visibleRows(root, collapsed, expandAll), [root, collapsed, expandAll]);
  const visibleFiles = rows.filter((r) => r.node.kind === 'file').map((r) => r.node.path);
  const { click } = useFileTreeSelection(selected, onSelect, visibleFiles);

  const toggleExpand = (path: string) => {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div
      className={cn('relative select-none overflow-y-auto border border-slate-800', className ?? 'max-h-64')}
      onContextMenu={(e) => {
        if (!onAddFolder) {
          return;
        }
        e.preventDefault();
        const rowEl = (e.target as HTMLElement).closest('[data-dir]');
        setMenu({
          x: e.clientX,
          y: e.clientY,
          dirPath: rowEl?.getAttribute('data-dir') ?? null,
          section: rowEl?.getAttribute('data-section') != null,
        });
      }}
      onDragOver={(e) => {
        if (onMove || onMoveFolder) {
          e.preventDefault();
          setDropDir('');
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        const paths = e.dataTransfer.getData('text/x-asset-paths');
        const dir = e.dataTransfer.getData('text/x-asset-dir');
        if (paths && onMove && dropDir != null) {
          onMove(JSON.parse(paths), dropDir === '' ? '' : dropDir);
        } else if (dir && onMoveFolder) {
          onMoveFolder(dir, '');
        }
        setDropDir(null);
      }}
      onDragLeave={() => setDropDir(null)}
    >
      {menu && onAddFolder && (
        <FileTreeMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onAddFolder={onAddFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
        />
      )}
      {rows.map((r) => (
        <FileTreeRow
          key={r.node.path || r.node.name}
          r={r}
          selected={selected}
          collapsed={collapsed}
          dropDir={dropDir}
          setDropDir={setDropDir}
          toggleExpand={toggleExpand}
          onRowClick={(row, e) => {
            setMenu(null);
            click(row, e);
          }}
          dragPaths={dragPaths}
          onMove={onMove}
          onMoveFolder={onMoveFolder}
          fileIcon={fileIcon}
        />
      ))}
      {rows.length === 0 && <p className="mt-3.5 mb-0 p-2 text-slate-400 text-xs">{emptyText}</p>}
    </div>
  );
}
