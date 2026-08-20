import type { ReactNode } from 'react';

export interface TreeFile {
  kind: 'file';
  name: string;
  path: string; // unique key: scan path, or an asset id for virtual trees
  /** Present for scanned directories; virtual trees carry ids instead. */
  handle?: FileSystemFileHandle;
  /** Optional dim suffix (file size etc). */
  note?: string;
}

export interface TreeDir {
  kind: 'dir';
  name: string;
  path: string;
  children: TreeNode[];
  /** 'section' renders as a dimmed full-width category band (still
   *  collapsible) — grouping chrome rather than content, e.g. a store. */
  variant?: 'section';
  /** Replaces the default folder icon for this dir. */
  icon?: ReactNode;
}

export type TreeNode = TreeFile | TreeDir;

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

/** All files in a subtree, depth-first. */
export function filesUnder(node: TreeNode): TreeFile[] {
  if (node.kind === 'file') {
    return [node];
  }
  return node.children.flatMap(filesUnder);
}

/** Flatten the visible rows (children of `root`, skipping collapsed dirs
 *  unless `expandAll` overrides — e.g. while a search filter is active). */
export function visibleRows(root: TreeDir, collapsed: ReadonlySet<string>, expandAll = false): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (n: TreeNode, depth: number) => {
    out.push({ node: n, depth });
    if (n.kind === 'dir' && (expandAll || !collapsed.has(n.path))) {
      for (const c of n.children) {
        walk(c, depth + 1);
      }
    }
  };
  for (const c of root.children) {
    walk(c, 0);
  }
  return out;
}
