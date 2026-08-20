import { IconChevronDown, IconChevronRight, IconFolder } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { filesUnder, type TreeRow } from './fileTreeModel';

/** One tree row: chevron (dirs), icon, name, note/count, selection highlight,
 *  and the drag-and-drop handlers for moving files/folders. */
export function FileTreeRow({
  r,
  selected,
  collapsed,
  dropDir,
  setDropDir,
  toggleExpand,
  onRowClick,
  dragPaths,
  onMove,
  onMoveFolder,
  fileIcon,
}: {
  r: TreeRow;
  selected: Set<string>;
  collapsed: Set<string>;
  dropDir: string | null;
  setDropDir: (d: string | null) => void;
  toggleExpand: (path: string) => void;
  onRowClick: (row: TreeRow, e: React.MouseEvent) => void;
  dragPaths: (path: string) => string[];
  onMove?: (paths: string[], dirPath: string) => void;
  onMoveFolder?: (dirPath: string, targetDirPath: string) => void;
  fileIcon: ReactNode;
}) {
  const n = r.node;
  const isSection = n.kind === 'dir' && n.variant === 'section';
  const isSel = n.kind === 'file' && selected.has(n.path);
  const dirFiles = n.kind === 'dir' ? filesUnder(n) : [];
  const dirSel = n.kind === 'dir' && dirFiles.length > 0 && dirFiles.every((f) => selected.has(f.path));

  return (
    <button
      type="button"
      key={n.path || n.name}
      className={cn(
        'flex w-full items-center gap-1.5 px-1.5 py-0.5 text-left text-xs',
        isSel || dirSel ? 'bg-blue-950 text-blue-100' : 'text-slate-300 hover:bg-slate-800',
        onMove && n.kind === 'dir' && dropDir === n.path && 'bg-blue-900 text-blue-100',
        isSection && !dirSel && 'border-slate-800 border-t bg-slate-900/70 text-slate-500',
      )}
      style={{ paddingLeft: `${6 + r.depth * 14}px` }}
      data-dir={n.kind === 'dir' ? n.path : undefined}
      data-section={isSection ? '1' : undefined}
      onClick={(e) => onRowClick(r, e)}
      draggable={(onMove != null && n.kind === 'file') || (onMoveFolder != null && n.kind === 'dir' && !isSection)}
      onDragStart={(e) => {
        if (n.kind === 'file') {
          e.dataTransfer.setData('text/x-asset-paths', JSON.stringify(dragPaths(n.path)));
        } else {
          e.dataTransfer.setData('text/x-asset-dir', n.path);
        }
      }}
      onDragOver={(e) => {
        if ((onMove || onMoveFolder) && n.kind === 'dir') {
          e.preventDefault();
          e.stopPropagation();
          setDropDir(n.path);
        }
      }}
      onDrop={(e) => {
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
      }}
    >
      {n.kind === 'dir' ? (
        <>
          {/* chevron = expand/collapse ONLY — it never touches the selection */}
          <span
            className="-m-1 shrink-0 p-1 hover:text-blue-300"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(n.path);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                toggleExpand(n.path);
              }
            }}
          >
            {collapsed.has(n.path) ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
          </span>
          {n.icon ?? <IconFolder size={13} className="shrink-0 text-slate-400" />}
        </>
      ) : (
        <span className="ml-3.5 flex shrink-0">{fileIcon}</span>
      )}
      <span className={cn('truncate', isSection && 'text-[10px] uppercase tracking-wider')}>{n.name}</span>
      {n.kind === 'file' && n.note != null && (
        <span className="ml-auto shrink-0 text-[10px] text-slate-500">{n.note}</span>
      )}
      {n.kind === 'dir' && <span className="ml-auto text-[10px] text-slate-500">{dirFiles.length}</span>}
    </button>
  );
}
