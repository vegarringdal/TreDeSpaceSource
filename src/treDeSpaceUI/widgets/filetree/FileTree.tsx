// A file-tree picker. Multi-select like a desktop file manager: click =
// select one, Ctrl+click = toggle, Shift+click = range over the VISIBLE rows,
// folder chevron = toggle expansion, folder Ctrl/plain click selects/deselects
// everything under it. Optional drag-and-drop moves and a right-click folder
// menu — see FileTreeProps.
import { IconFile3d } from '@tabler/icons-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { Menu, type MenuEntry } from '../menu/Menu';
import { type TreeRowExtras, TreeView, type TreeViewRow } from '../tree/TreeView';
import { dirPaths, type TreeDir, type TreeRow, visibleRows } from './fileTreeModel';
import { toTreeRows } from './fileTreeRows';
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

type MenuState = { x: number; y: number; dirPath: string | null; section: boolean };

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
  const [menu, setMenu] = useState<MenuState | null>(null);

  /** Paths that travel in a drag: the whole selection when dragging a selected
   *  row, else just the dragged row. */
  const dragPaths = (path: string): string[] => (selected.has(path) ? [...selected] : [path]);

  const rows = useMemo(() => visibleRows(root, collapsed, expandAll), [root, collapsed, expandAll]);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.node.path || r.node.name, r])), [rows]);
  const visibleFiles = rows.filter((r) => r.node.kind === 'file').map((r) => r.node.path);
  const { click } = useFileTreeSelection(selected, onSelect, visibleFiles);
  const treeRows = useMemo(
    () => toTreeRows(rows, selected, collapsed, expandAll, fileIcon),
    [rows, selected, collapsed, expandAll, fileIcon],
  );

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

  const nodeOf = (row: TreeViewRow): TreeRow | undefined => byKey.get(row.key);

  /** Drag-and-drop and the data-dir markers the container's menu handler reads. */
  const rowExtras = (row: TreeViewRow): TreeRowExtras | undefined => {
    const r = nodeOf(row);
    if (!r) {
      return undefined;
    }
    const n = r.node;
    const isSection = n.kind === 'dir' && n.variant === 'section';
    return {
      draggable: (onMove != null && n.kind === 'file') || (onMoveFolder != null && n.kind === 'dir' && !isSection),
      className: cn(onMove && n.kind === 'dir' && dropDir === n.path && 'bg-blue-900 text-blue-100'),
      data: { 'data-dir': n.kind === 'dir' ? n.path : undefined, 'data-section': isSection ? '1' : undefined },
      onDragStart: (e) => {
        if (n.kind === 'file') {
          e.dataTransfer.setData('text/x-asset-paths', JSON.stringify(dragPaths(n.path)));
        } else {
          e.dataTransfer.setData('text/x-asset-dir', n.path);
        }
      },
      onDragOver: (e) => {
        if ((onMove || onMoveFolder) && n.kind === 'dir') {
          e.preventDefault();
          e.stopPropagation();
          setDropDir(n.path);
        }
      },
      onDrop: (e) => {
        if (n.kind !== 'dir') {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const paths = e.dataTransfer.getData('text/x-asset-paths');
        const dir = e.dataTransfer.getData('text/x-asset-dir');
        if (paths && onMove) {
          onMove(JSON.parse(paths), n.path);
        } else if (dir && onMoveFolder && dir !== n.path) {
          onMoveFolder(dir, n.path);
        }
        setDropDir(null);
      },
    };
  };

  const menuItems = (m: MenuState): MenuEntry[] => {
    const dir = m.dirPath;
    const editable = dir != null && !m.section;
    return [
      {
        id: 'add',
        label: dir != null ? 'New folder inside…' : 'New folder…',
        onSelect: () => onAddFolder?.(dir),
      },
      editable &&
        onRenameFolder != null && { id: 'rename', label: 'Rename folder…', onSelect: () => onRenameFolder(dir) },
      editable &&
        onDeleteFolder != null && {
          id: 'delete',
          label: 'Delete folder…',
          danger: true,
          onSelect: () => onDeleteFolder(dir),
        },
    ];
  };

  return (
    <div
      className={cn('relative flex select-none flex-col border border-slate-800', className ?? 'max-h-64')}
      onContextMenu={(e) => {
        if (!onAddFolder) {
          return;
        }
        e.preventDefault();
        // Element, not HTMLElement: a right-click on a row's icon targets an
        // SVGElement, which would otherwise lose the row it came from
        const rowEl = e.target instanceof Element ? e.target.closest('[data-dir]') : null;
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
        <Menu anchor={menu} items={menuItems(menu)} minWidth={144} onClose={() => setMenu(null)} />
      )}
      <TreeView
        rows={treeRows}
        className="min-h-0 flex-1"
        emptyText={emptyText}
        rowProps={rowExtras}
        onToggle={(row) => toggleExpand(row.key)}
        onRowClick={(row, e) => {
          setMenu(null);
          const r = nodeOf(row);
          if (r) {
            click(r, e);
          }
        }}
      />
    </div>
  );
}
