import type { DropZone, LayoutNode, Size, SplitNode, TabsNode } from './types';

let counter = 0;
export const uid = (prefix = 'n') => `${prefix}${(++counter).toString(36)}${Date.now().toString(36).slice(-3)}`;

export const tabs = (panels: string[], extra: Partial<TabsNode> = {}): TabsNode => ({
  id: uid('t'),
  type: 'tabs',
  panels,
  activePanel: panels[0],
  ...extra,
});

export const split = (
  direction: 'row' | 'column',
  children: LayoutNode[],
  sizes?: number[],
  extra: Partial<SplitNode> = {},
): SplitNode => ({
  id: uid('s'),
  type: 'split',
  direction,
  children,
  sizes: sizes ?? children.map(() => 1),
  ...extra,
});

export function walk(
  node: LayoutNode,
  fn: (n: LayoutNode, parent: SplitNode | null) => void,
  parent: SplitNode | null = null,
) {
  fn(node, parent);
  if (node.type === 'split') {
    for (const c of node.children) {
      walk(c, fn, node);
    }
  }
}

export function findNode(root: LayoutNode, id: string): LayoutNode | null {
  let found: LayoutNode | null = null;
  walk(root, (n) => {
    if (n.id === id) {
      found = n;
    }
  });
  return found;
}

export function findParent(root: LayoutNode, id: string): SplitNode | null {
  let found: SplitNode | null = null;
  walk(root, (n, parent) => {
    if (n.id === id) {
      found = parent;
    }
  });
  return found;
}

export function findTabsWithPanel(root: LayoutNode, panelId: string): TabsNode | null {
  let found: TabsNode | null = null;
  walk(root, (n) => {
    if (n.type === 'tabs' && n.panels.includes(panelId)) {
      found = n;
    }
  });
  return found;
}

export function allPanels(root: LayoutNode): string[] {
  const out: string[] = [];
  walk(root, (n) => {
    if (n.type === 'tabs') {
      out.push(...n.panels);
    }
  });
  return out;
}

/** True if the node or any ancestor is locked. */
export function isLocked(root: LayoutNode, id: string): boolean {
  const path: LayoutNode[] = [];
  const search = (n: LayoutNode, trail: LayoutNode[]): boolean => {
    const next = [...trail, n];
    if (n.id === id) {
      path.push(...next);
      return true;
    }
    if (n.type === 'split') {
      return n.children.some((c) => search(c, next));
    }
    return false;
  };
  search(root, []);
  return path.some((n) => n.locked);
}

/**
 * Drop a panel out of the tree, pruning empty tabs and collapsing single-child
 * splits. Returns the new root (never null — an empty tabs node survives).
 */
export function removePanel(root: LayoutNode, panelId: string): LayoutNode {
  const prune = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'tabs') {
      if (!node.panels.includes(panelId)) {
        return node;
      }
      const panels = node.panels.filter((p) => p !== panelId);
      if (panels.length === 0) {
        return null;
      }
      const activePanel = node.activePanel === panelId ? panels[0] : node.activePanel;
      return { ...node, panels, activePanel };
    }
    const kept: LayoutNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, i) => {
      const next = prune(child);
      if (next) {
        kept.push(next);
        sizes.push(node.sizes[i] ?? 1);
      }
    });
    if (kept.length === 0) {
      return null;
    }
    if (kept.length === 1) {
      // Collapse: keep the survivor but inherit our slot in the parent.
      const only = kept[0];
      return { ...only, fixedSize: only.fixedSize ?? node.fixedSize };
    }
    return { ...node, children: kept, sizes };
  };

  return prune(root) ?? tabs([]);
}

/** Replace one node with another, by id. */
export function replaceNode(root: LayoutNode, targetId: string, make: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (root.id === targetId) {
    return make(root);
  }
  if (root.type === 'split') {
    return { ...root, children: root.children.map((c) => replaceNode(c, targetId, make)) };
  }
  return root;
}

/** Add a panel to an existing tabs node (optionally at an index) and focus it. */
export function insertIntoTabs(root: LayoutNode, tabsId: string, panelId: string, index?: number): LayoutNode {
  return replaceNode(root, tabsId, (node) => {
    if (node.type !== 'tabs') {
      return node;
    }
    const panels = node.panels.filter((p) => p !== panelId);
    panels.splice(index ?? panels.length, 0, panelId);
    return { ...node, panels, activePanel: panelId };
  });
}

export type SplitZone = Exclude<DropZone, 'center' | 'float'>;

/** Split `targetId` and put `panelId` on the given side of it. */
export function splitWithPanel(root: LayoutNode, targetId: string, panelId: string, zone: SplitZone): LayoutNode {
  const direction: 'row' | 'column' = zone === 'left' || zone === 'right' ? 'row' : 'column';
  const before = zone === 'left' || zone === 'top';

  return replaceNode(root, targetId, (node) => {
    const leaf = tabs([panelId]);
    // The existing node's slot size belongs to the new split, not to the child.
    const inheritedFixed = node.fixedSize;
    const inner: LayoutNode = { ...node, fixedSize: undefined };
    const kids = before ? [leaf, inner] : [inner, leaf];
    return split(direction, kids, [1, 1], inheritedFixed != null ? { fixedSize: inheritedFixed } : {});
  });
}

const DEFAULT_MIN_W = 120;
const DEFAULT_MIN_H = 60;

export interface MeasureEnv {
  headerHeight: number;
  splitterSize: number;
  /** Effective (definition + runtime override) minimum for a panel. */
  panelMin(panelId: string): Size;
}

/** Smallest box a node can be squeezed into, in px. */
export function measureMin(node: LayoutNode, env: MeasureEnv): Size {
  if (node.type === 'tabs') {
    // Collapsed: the strip is the whole node, in either orientation.
    if (node.collapsed) {
      return { width: env.headerHeight, height: env.headerHeight };
    }
    let width = 60;
    let height = 0;
    for (const p of node.panels) {
      const m = env.panelMin(p);
      width = Math.max(width, m.width || DEFAULT_MIN_W);
      height = Math.max(height, m.height || DEFAULT_MIN_H);
    }
    const header = node.hideTabs ? 0 : env.headerHeight;
    // the padlock floor: a size-locked group's minimum is the size it was
    // locked at — folding it in HERE makes it hold through any nesting
    if (node.sizeLocked && node.lockedSize) {
      return {
        width: Math.max(width, node.lockedSize.width),
        height: Math.max(height + header, node.lockedSize.height),
      };
    }
    return { width, height: height + header };
  }

  // A child with an explicit fixedSize is exactly that big along our axis; the
  // author asked for pixels, so pixels win over the content minimum.
  const mins = node.children.map((c) => {
    const m = measureMin(c, env);
    if (c.fixedSize == null) {
      return m;
    }
    return node.direction === 'row' ? { ...m, width: c.fixedSize } : { ...m, height: c.fixedSize };
  });
  const gaps = env.splitterSize * Math.max(0, node.children.length - 1);
  if (node.direction === 'row') {
    return {
      width: mins.reduce((a, m) => a + m.width, 0) + gaps,
      height: Math.max(0, ...mins.map((m) => m.height)),
    };
  }
  return {
    width: Math.max(0, ...mins.map((m) => m.width)),
    height: mins.reduce((a, m) => a + m.height, 0) + gaps,
  };
}

/** Which zone of a rect a point falls into. Center = drop as a tab. */
export function zoneAt(rect: DOMRect, x: number, y: number, edge = 0.28): DropZone {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const d = [
    { z: 'left' as const, v: fx },
    { z: 'right' as const, v: 1 - fx },
    { z: 'top' as const, v: fy },
    { z: 'bottom' as const, v: 1 - fy },
  ].sort((a, b) => a.v - b.v)[0];
  return d.v < edge ? d.z : 'center';
}

export function cloneLayout<T extends LayoutNode>(node: T): T {
  return structuredClone(node);
}

/** True when a tree holds no panels at all. */
export function isEmpty(node: LayoutNode): boolean {
  return allPanels(node).length === 0;
}

/**
 * Re-insert locked "furniture" (toolbars, ribbon strips) that a restored layout
 * has lost, using `template` (the pristine default) as the source of truth.
 *
 * A locked node can't be closed, floated or dragged out by the user, so its
 * absence from a saved layout is always breakage — an older snapshot taken
 * before a ribbon existed, or one that somehow dropped the strip. Restoring it
 * blindly then leaves furniture missing until the user hits Reset. This heals
 * two cases without disturbing the user's own docking, sizes or tab order:
 *   • a surviving furniture node that lost some pinned panels (e.g. ribbons
 *     added in a newer build than the save) — the missing ones are spliced back
 *     in template order, active tab untouched;
 *   • a furniture node gone entirely — its template copy is wrapped back on at
 *     the edge where the template kept it, so it stays outermost.
 * Returns the healed root; a layout that already has all its furniture is
 * returned structurally unchanged.
 */
export function healFurniture(root: LayoutNode, template: LayoutNode): LayoutNode {
  // Topmost locked nodes in the template, with where each sat in its parent.
  const furniture: { node: LayoutNode; underRoot: boolean; before: boolean; dir: 'row' | 'column' }[] = [];
  const collect = (n: LayoutNode, parent: SplitNode | null) => {
    if (n.locked) {
      furniture.push({
        node: n,
        underRoot: parent?.id === template.id,
        before: parent ? parent.children.indexOf(n) === 0 : true,
        dir: parent?.direction ?? 'column',
      });
      return; // don't descend into locked furniture — one strip, not its leaves
    }
    if (n.type === 'split') {
      for (const c of n.children) {
        collect(c, n);
      }
    }
  };
  collect(template, null);

  let out = root;
  for (const f of furniture) {
    const existing = findNode(out, f.node.id);
    if (existing?.type === 'tabs' && f.node.type === 'tabs') {
      const tmpl = f.node.panels;
      const have = new Set(allPanels(out));
      const missing = tmpl.filter((p) => !have.has(p));
      if (missing.length === 0) {
        continue;
      }
      out = replaceNode(out, f.node.id, (node) => {
        if (node.type !== 'tabs') {
          return node;
        }
        const panels = [...node.panels];
        // insert each missing panel at its template position (clamped)
        tmpl.forEach((p, i) => {
          if (missing.includes(p)) {
            panels.splice(Math.min(i, panels.length), 0, p);
          }
        });
        return { ...node, panels };
      });
    } else if (!existing) {
      // Furniture node vanished — splice the template's copy back on. When it sat
      // directly under the template root, wrap on its original edge; otherwise
      // keep it outermost by prepending.
      const clone = cloneLayout(f.node);
      const before = f.underRoot ? f.before : true;
      out = split(f.dir, before ? [clone, out] : [out, clone], [1, 1]);
    }
  }
  return out;
}

/* -------------------------------------------------------------- dock regions */

function countUnlocked(node: LayoutNode, lockedAbove = false): number {
  const locked = lockedAbove || !!node.locked;
  if (node.type === 'tabs') {
    return locked ? 0 : 1;
  }
  return node.children.reduce((sum, c) => sum + countUnlocked(c, locked), 0);
}

/**
 * The dockable area: the deepest unlocked node that still contains every
 * unlocked leaf. With a locked toolbar on top, this is everything below it —
 * so "dock top" lands under the toolbar, not above it.
 */
export function dockRegion(root: LayoutNode): LayoutNode {
  const total = countUnlocked(root);
  let best = root;
  const descend = (n: LayoutNode, lockedAbove: boolean) => {
    if (lockedAbove || n.locked) {
      return;
    }
    if (countUnlocked(n) === total) {
      best = n;
      if (n.type === 'split') {
        for (const c of n.children) {
          descend(c, false);
        }
      }
    }
  };
  descend(root, false);
  return best;
}

/**
 * Dock a panel against one edge of a region, flattening into it when possible.
 * Locked children (toolbar-style furniture) always stay outermost: the panel
 * lands just inside them, never beside or beyond them.
 */
export function dockAtEdge(root: LayoutNode, regionId: string, panelId: string, zone: SplitZone): LayoutNode {
  const dir: 'row' | 'column' = zone === 'left' || zone === 'right' ? 'row' : 'column';
  const before = zone === 'left' || zone === 'top';
  const region = findNode(root, regionId);

  if (region?.type === 'split') {
    const first = region.children.findIndex((c) => !c.locked);
    const last = region.children.length - 1 - [...region.children].reverse().findIndex((c) => !c.locked);

    if (region.direction === dir) {
      return replaceNode(root, regionId, (n) => {
        if (n.type !== 'split') {
          return n;
        }
        const s = n;
        const total = s.sizes.reduce((a, b) => a + b, 0) || s.children.length;
        const children = [...s.children];
        const sizes = [...s.sizes];
        const at = before ? Math.max(first, 0) : last + 1;
        children.splice(at, 0, tabs([panelId]));
        sizes.splice(at, 0, total * 0.3);
        return { ...s, children, sizes };
      });
    }

    if (first > 0 || last < region.children.length - 1) {
      // Cross-direction dock while the region holds locked furniture: split
      // only the unlocked block, leaving the furniture spanning the region.
      return replaceNode(root, regionId, (n) => {
        if (n.type !== 'split') {
          return n;
        }
        const s = n;
        const children = [...s.children];
        const sizes = [...s.sizes];
        const block = children.slice(first, last + 1);
        const blockSizes = sizes.slice(first, last + 1);
        const inner = block.length === 1 ? block[0] : split(s.direction, block, blockSizes);
        const leaf = tabs([panelId]);
        const wrapped = split(dir, before ? [leaf, inner] : [inner, leaf], [3, 7]);
        children.splice(first, block.length, wrapped);
        sizes.splice(first, block.length, blockSizes.reduce((a, b) => a + b, 0) || 1);
        return { ...s, children, sizes };
      });
    }
  }
  return splitWithPanel(root, regionId, panelId, zone);
}

/**
 * Stack a panel underneath another. If the target already sits in a column,
 * the new panel joins that column as a sibling rather than nesting a split
 * inside it — so dragging onto the bottom of the last panel just adds a row.
 */
export function dockBelow(root: LayoutNode, targetId: string, panelId: string): LayoutNode {
  const target = findNode(root, targetId);
  const parent = findParent(root, targetId);

  if (target && target.fixedSize == null && parent && parent.direction === 'column' && !parent.locked) {
    return replaceNode(root, parent.id, (n) => {
      if (n.type !== 'split') {
        return n;
      }
      const s = n;
      const i = s.children.findIndex((c) => c.id === targetId);
      const children = [...s.children];
      const sizes = [...s.sizes];
      const half = (sizes[i] ?? 1) / 2;
      sizes[i] = half;
      children.splice(i + 1, 0, tabs([panelId]));
      sizes.splice(i + 1, 0, half);
      return { ...s, children, sizes };
    });
  }
  return splitWithPanel(root, targetId, panelId, 'bottom');
}

/**
 * True when nothing in this subtree is showing content. A column whose panels
 * are all collapsed has nothing to display, so it should give up its width to
 * its siblings and become a rail — not sit there as a wide stack of strips.
 */
/**
 * Structural normalization: hoist single-child splits and inline same-axis
 * child splits into their parent (weights rescaled so rendered proportions
 * are unchanged). Drag-dock operations nest liberally; without this a
 * visually flat PANEL1|PANEL2|PANEL3 row can secretly be a split-in-a-split,
 * and divider cascades — which walk REAL siblings — stop at the hidden
 * boundary. Locked or fixed-size sub-splits are left intact (their scope
 * carries meaning).
 */
export function normalizeLayout(node: LayoutNode): LayoutNode {
  if (node.type !== 'split') {
    return node;
  }
  const kids = node.children.map(normalizeLayout);
  if (kids.length === 1 && !node.locked) {
    const only = kids[0];
    if (node.fixedSize != null && only.fixedSize == null) {
      only.fixedSize = node.fixedSize;
    }
    return only;
  }
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  kids.forEach((kid, i) => {
    const w = node.sizes[i] > 0 ? node.sizes[i] : 1;
    if (kid.type === 'split' && kid.direction === node.direction && !kid.locked && kid.fixedSize == null) {
      const innerTotal = kid.children.reduce((a, _c, j) => a + (kid.sizes[j] > 0 ? kid.sizes[j] : 1), 0) || 1;
      kid.children.forEach((gc, j) => {
        children.push(gc);
        sizes.push((w * (kid.sizes[j] > 0 ? kid.sizes[j] : 1)) / innerTotal);
      });
    } else {
      children.push(kid);
      sizes.push(w);
    }
  });
  node.children = children;
  node.sizes = sizes;
  return node;
}

export function isCollapsedTree(node: LayoutNode): boolean {
  if (node.type === 'tabs') {
    return !!node.collapsed;
  }
  return node.children.length > 0 && node.children.every(isCollapsedTree);
}
