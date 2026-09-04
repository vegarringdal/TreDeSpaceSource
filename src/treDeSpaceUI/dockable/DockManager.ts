import { html, nothing, render, type TemplateResult } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { repeat } from 'lit-html/directives/repeat.js';
import { styleMap } from 'lit-html/directives/style-map.js';
import * as L from './layout';
import type {
  DockManagerOptions,
  DockState,
  DropZone,
  FloatingWindow,
  LayoutNode,
  PanelContext,
  PanelDefinition,
  Rect,
  Size,
  SplitNode,
  TabsNode,
} from './types';

interface Host {
  el: HTMLElement;
  dispose?: () => void;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * What a release would do, resolved live while dragging.
 *   dock  — a compass button: dock against the whole dock area
 *   tab   — the tab strip of one panel: insert/reorder there
 *   below — the lower band of one panel: stack underneath it
 *   float — anything else: pop out into a window
 *   none  — the panel is already there. No preview, no drop, no helper shown.
 */
interface DropTarget {
  kind: 'dock' | 'tab' | 'float' | 'none';
  zone?: Exclude<DropZone, 'float'>;
  /** Directional zone hits the INNER half: split the central leaf instead of
   *  docking against the whole area (the outer half). */
  inner?: boolean;
  /** Came from an outer-ring compass button (drives which button lights up). */
  outer?: boolean;
  nodeId?: string;
  tabIndex?: number;
  /** Where the panel will land, in viewport coords. Drawn as the blue rectangle. */
  preview?: Box;
  /** The panel under the pointer, whatever the outcome. Drives the stack-below hint. */
  hoverNodeId?: string;
  hoverRect?: DOMRect;
}

/** A same-axis nested split touching the divider, captured at drag start so
 *  the child NEXT TO the divider absorbs first (rule: dragging the 2|3 bar
 *  must never move panel 1 inside a nested 1|2 split). */
interface InnerCapture {
  splitId: string;
  startPx: number[];
  minPx: number[];
  /** never resized by a drag: collapsed / furniture-locked / fixed-size */
  rigid: boolean[];
  /** size-locked: passed over as a grow target while unlocked panels exist,
   *  so the block slides instead of inflating */
  locked: boolean[];
}

interface ResizeDrag {
  kind: 'resize';
  splitId: string;
  /** the divider sits between children[index] and children[index + 1] */
  index: number;
  axis: 'row' | 'column';
  startPos: number;
  /** pixel size of EVERY child at drag start (live DOM rects) */
  startPx: number[];
  /** minimum along the axis per child (measureMin over the subtree; a
   *  size-locked group's floor is the size it was locked at) */
  minPx: number[];
  rigid: boolean[];
  locked: boolean[];
  /** original fixedSize of the two adjacent children — the write target while
   *  dragging and the restore value on Escape (null = flex child) */
  aFixed: number | null;
  bFixed: number | null;
  aInner: InnerCapture | null;
  bInner: InnerCapture | null;
}

interface PanelDrag {
  kind: 'panel';
  panelId: string;
  startX: number;
  startY: number;
  threshold: number;
  active: boolean;
  ghost?: HTMLElement;
  target?: DropTarget;
  /** The panel the compass is anchored to — sticky while the pointer is on a
   *  compass button (so aiming at a button can't re-anchor the compass). */
  anchor?: { nodeId: string; rect: DOMRect };
  cancelled?: boolean;
}

interface WindowDrag {
  kind: 'window';
  windowId: string;
  mode: 'move' | 'resize';
  edges: { n: boolean; s: boolean; e: boolean; w: boolean };
  startX: number;
  startY: number;
  start: Rect;
  min: Size;
}

type Drag = ResizeDrag | PanelDrag | WindowDrag;

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * The dock. Framework-free: owns a layout tree plus a list of floating windows,
 * renders chrome with lit-html, and hands each panel a plain HTMLElement to
 * fill however it likes.
 *
 * All interaction is Pointer Events, so mouse, pen and touch take the same path.
 */
export class DockManager {
  root: LayoutNode;
  windows: FloatingWindow[];
  /** Bumped on every layout change. Useful as a `useSyncExternalStore` snapshot. */
  version = 0;

  private defs = new Map<string, PanelDefinition>();
  private hosts = new Map<string, Host>();
  /** Panels hidden while a deferred close (`beforeClose`) waits: out of the
   *  strips and of saved layouts, content still mounted in place. */
  private closing = new Set<string>();
  private runtimeMin = new Map<string, Partial<Size>>();
  private titleOverrides = new Map<string, string>();
  /** Where each panel lived when last closed — reopened there if it still exists. */
  private lastLocation = new Map<string, string>();
  /** The layout passed at construction, for resetLayout(). */
  private initialLayout: LayoutNode;
  private listeners = new Set<() => void>();

  private container: HTMLElement | null = null;
  private drag: Drag | null = null;
  private frame = 0;
  private zTop = 1;
  /** Measured tab-strip height per tabs node (see watchStrips). */
  private stripHeights = new Map<string, number>();
  private stripObserver: ResizeObserver | null = null;

  readonly coarse = coarse();
  readonly headerHeight: number;
  readonly tabMinWidth: number;
  readonly splitterSize: number;
  readonly windowBarHeight: number;
  readonly defaultWindowSize: Size;

  constructor(options: DockManagerOptions) {
    for (const p of options.panels) {
      this.defs.set(p.id, p);
    }
    this.initialLayout = L.cloneLayout(options.layout);
    this.root = L.normalizeLayout(options.layout);
    this.windows = options.windows ?? [];
    this.headerHeight = options.headerHeight ?? 22;
    this.splitterSize = options.splitterSize ?? 6;
    this.tabMinWidth = options.tabMinWidth ?? 0;
    this.windowBarHeight = options.windowBarHeight ?? 26;
    this.defaultWindowSize = options.defaultWindowSize ?? { width: 340, height: 260 };
    for (const w of this.windows) {
      this.zTop = Math.max(this.zTop, w.z + 1);
    }
  }

  // ---------------------------------------------------------------- lifecycle

  mount(container: HTMLElement) {
    this.container = container;
    container.classList.add('dock-root');
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('focus', this.onWindowFocus);
    this.renderNow();
  }

  unmount() {
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('focus', this.onWindowFocus);
    this.stripObserver?.disconnect();
    this.stripObserver = null;
    this.stripHeights.clear();
    this.onWindowFocus(); // stop the iframe-focus poll
    this.unbindDragListeners();
    for (const host of this.hosts.values()) {
      host.dispose?.();
    }
    this.hosts.clear();
    if (this.container) {
      render(nothing, this.container);
      this.container.classList.remove('dock-root');
    }
    this.container = null;
  }

  /** Subscribe to layout changes (open/close/move/resize/float). Returns an unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ------------------------------------------------------------------- panels

  registerPanel(def: PanelDefinition) {
    this.defs.set(def.id, def);
  }

  /** Forget a panel definition — for panels registered at runtime. Closes it
   *  first if it is open (without firing `onClose`: the caller is the one
   *  removing it), and drops its remembered location, title and min size, so
   *  a later panel reusing the id starts clean. */
  unregisterPanel(panelId: string) {
    if (this.isOpen(panelId)) {
      this.closePanel(panelId, { silent: true });
    }
    this.defs.delete(panelId);
    this.lastLocation.delete(panelId);
    this.titleOverrides.delete(panelId);
    this.runtimeMin.delete(panelId);
  }

  getPanel(id: string) {
    return this.defs.get(id);
  }

  /** Every panel currently in the dock or in a window. */
  openPanels(): string[] {
    return this.trees().flatMap((t) => L.allPanels(t));
  }

  /** Registered but not placed anywhere — build a View menu from this. */
  closedPanels(): PanelDefinition[] {
    const open = new Set(this.openPanels());
    return [...this.defs.values()].filter((d) => !open.has(d.id));
  }

  isOpen(panelId: string) {
    return this.openPanels().includes(panelId);
  }

  isFloating(panelId: string) {
    return this.windows.some((w) => L.allPanels(w.node).includes(panelId));
  }

  title(panelId: string) {
    return this.titleOverrides.get(panelId) ?? this.defs.get(panelId)?.title ?? panelId;
  }

  /** Open (or focus) a panel. Docks into `targetNodeId`, else the first
   *  unlocked tabs node. A `targetNodeId` of `'left'`/`'right'`/`'bottom'` is
   *  recreated when that side column was pruned, so callers can force a side
   *  regardless of the current layout. */
  openPanel(panelId: string, targetNodeId?: string) {
    if (!this.defs.has(panelId)) {
      throw new Error(`dockable: unknown panel "${panelId}"`);
    }
    if (this.isOpen(panelId)) {
      this.focusPanel(panelId);
      return;
    }
    const home = this.homeOf(panelId);
    const remembered = this.lastLocation.get(panelId);
    const softHome = this.defs.get(panelId)?.home;
    const t1 = targetNodeId ? (this.ensureHomeNode(targetNodeId) ?? undefined) : undefined;
    const t2 = remembered && this.findNodeAnywhere(remembered) ? remembered : undefined;
    // a missing soft-home side node ('right'/'left'/'bottom') is RECREATED so a
    // right-home panel never lands in the left column just because every right
    // panel happened to be closed
    const t3 = softHome ? this.ensureHomeNode(softHome) : undefined;
    const t4 = home?.find((id) => this.findNodeAnywhere(id));
    const target = t1 ?? t2 ?? t3 ?? t4 ?? this.defaultDropTarget()?.id;
    if (!target) {
      this.root = L.tabs([panelId]);
    } else if (this.canDockInto(panelId, target)) {
      this.insertInto(target, panelId);
    } else {
      return; // pinned panel, and its home isn't in the layout
    }
    this.commit();
  }

  /** Open `panelId` split on `zone` of the panel `siblingId` lives in (falls
   *  back to openPanel when the sibling isn't docked or a remembered spot
   *  exists). */
  openPanelBeside(panelId: string, siblingId: string, zone: L.SplitZone) {
    if (this.isOpen(panelId)) {
      this.focusPanel(panelId);
      return;
    }
    const remembered = this.lastLocation.get(panelId);
    const sibling = this.nodeOf(siblingId);
    if ((remembered && this.findNodeAnywhere(remembered)) || !sibling) {
      this.openPanel(panelId);
      return;
    }
    this.root = L.splitWithPanel(this.root, sibling, panelId, zone);
    this.commit();
  }

  /** Open `panelId` split BELOW the panel `siblingId` lives in. */
  openPanelBelow(panelId: string, siblingId: string) {
    this.openPanelBeside(panelId, siblingId, 'bottom');
  }

  /** Close a panel. When its definition's `beforeClose` returns a promise the
   *  panel is hidden at once (tab and content) but stays mounted until the
   *  promise settles, then is detached — see `PanelDefinition.beforeClose`.
   *  `silent` (`registerPanel` replacing an open def) skips the hook and
   *  `onClose`, and ends any wait in progress right away. */
  closePanel(panelId: string, opts: { silent?: boolean } = {}) {
    if (!this.isOpen(panelId)) {
      return;
    }
    if (opts.silent) {
      this.closing.delete(panelId);
      this.finishClose(panelId, true);
      return;
    }
    if (this.closing.has(panelId)) {
      return;
    }
    const wait = this.defs.get(panelId)?.beforeClose?.(panelId);
    if (!wait) {
      this.finishClose(panelId, false);
      return;
    }
    this.closing.add(panelId);
    this.commit();
    const finish = () => {
      if (this.closing.delete(panelId)) {
        this.finishClose(panelId, false);
      }
    };
    wait.then(finish, finish);
  }

  private finishClose(panelId: string, silent: boolean) {
    if (!this.isOpen(panelId)) {
      return;
    }
    // remember where it was so reopening returns it to the same node
    const node = this.nodeOf(panelId);
    if (node) {
      this.lastLocation.set(panelId, node);
    }
    this.detach(panelId);
    const host = this.hosts.get(panelId);
    if (host) {
      host.dispose?.();
      host.el.remove();
      this.hosts.delete(panelId);
    }
    this.runtimeMin.delete(panelId);
    this.commit();
    if (!silent) {
      this.defs.get(panelId)?.onClose?.(panelId);
    }
  }

  /** The node's panels minus those hidden while a deferred close waits. */
  private shownPanels(node: { panels: string[] }): string[] {
    return this.closing.size ? node.panels.filter((id) => !this.closing.has(id)) : node.panels;
  }

  /** Every registered panel definition (drives a Panels toggle bar). */
  allDefs(): PanelDefinition[] {
    return [...this.defs.values()];
  }

  /** Open (restoring the last location) if closed, else close. */
  togglePanel(panelId: string) {
    if (this.isOpen(panelId)) {
      this.closePanel(panelId);
    } else {
      this.openPanel(panelId);
    }
  }

  /** Restore the layout the manager was constructed with. */
  /** Solo mode: close every unlocked panel except the main (central) one;
   *  a second call restores the exact layout from before. */
  toggleSolo() {
    if (this.soloSnapshot) {
      this.loadLayout(this.soloSnapshot);
      this.soloSnapshot = null;
      return;
    }
    const central = this.centralLeaf();
    if (!central) {
      return;
    }
    const centralNode = this.findNodeAnywhere(central.id);
    const keep = new Set(centralNode?.type === 'tabs' ? centralNode.panels : []);
    const snapshot = this.saveLayout();
    let closed = 0;
    for (const id of this.openPanels()) {
      const node = this.nodeOf(id);
      if (keep.has(id) || (node && this.isNodeLocked(node))) {
        continue; // ribbons etc stay
      }
      this.closePanel(id);
      closed++;
    }
    if (closed > 0) {
      this.soloSnapshot = snapshot;
    }
  }

  private soloSnapshot: DockState | null = null;

  /** True while solo mode is on (a pre-solo layout is waiting to be restored). */
  isSolo(): boolean {
    return this.soloSnapshot != null;
  }

  resetLayout() {
    this.loadLayout(L.cloneLayout(this.initialLayout));
  }

  /** Collapse a node to its strip, or open it back up. */
  setCollapsed(nodeId: string, collapsed: boolean) {
    const node = this.findNodeAnywhere(nodeId);
    if (node?.type !== 'tabs') {
      return;
    }
    // Locked nodes are frozen furniture — but an explicit `collapsible: true`
    // opts back in: collapsing hides nothing that locking protects.
    if (node.collapsible === false || (this.isNodeLocked(nodeId) && node.collapsible !== true)) {
      return;
    }
    if (!!node.collapsed === collapsed) {
      return;
    }
    node.collapsed = collapsed;
    this.commit();
  }

  /** Toggle the tab-strip padlock. Locking captures the group's CURRENT size
   *  as its new minimum: divider drags push it as a block and never shrink it
   *  below the size it was locked at. */
  toggleSizeLock(nodeId: string) {
    const node = this.findNodeAnywhere(nodeId);
    if (node?.type !== 'tabs') {
      return;
    }
    if (node.sizeLocked) {
      node.sizeLocked = undefined;
      node.lockedSize = undefined;
    } else {
      node.sizeLocked = true;
      // the lock floor: the group's current rendered size, both axes —
      // measureMin folds it into every min from here on
      const el = document.querySelector(`[data-node="${nodeId}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        node.lockedSize = { width: r.width, height: r.height };
      }
    }
    this.commit();
  }

  toggleCollapse(nodeId: string) {
    const node = this.findNodeAnywhere(nodeId);
    if (node?.type === 'tabs') {
      this.setCollapsed(nodeId, !node.collapsed);
    }
  }

  isCollapsed(nodeId: string): boolean {
    const node = this.findNodeAnywhere(nodeId);
    return node?.type === 'tabs' && !!node.collapsed;
  }

  /** The node a panel lives in — handy for collapsing it by panel id. */
  nodeOf(panelId: string): string | null {
    for (const tree of this.trees()) {
      const node = L.findTabsWithPanel(tree, panelId);
      if (node) {
        return node.id;
      }
    }
    return null;
  }

  focusPanel(panelId: string) {
    for (const tree of this.trees()) {
      const node = L.findTabsWithPanel(tree, panelId);
      if (node) {
        node.activePanel = panelId;
        if (node.collapsed) {
          node.collapsed = false; // asking for a panel means you want to see it
        }
        const win = this.windows.find((w) => L.findNode(w.node, node.id));
        if (win) {
          win.z = this.zTop++;
        }
        this.commit();
        return;
      }
    }
  }

  // ------------------------------------------------------ iframe focus raise
  // Clicks INSIDE an iframe never reach the parent document, so a floating
  // window hosting one (external app panels/dialogs) would stay behind other
  // windows. The only parent-side signal is our window losing focus with the
  // iframe as the new activeElement — watch for that and raise its window.
  // While our window stays blurred (the user hops between two iframes) no
  // further blur event fires, so a slow poll covers that until focus returns.
  private framePoll: ReturnType<typeof setInterval> | null = null;
  private lastFrameEl: Element | null = null;
  private readonly onWindowBlur = () => {
    setTimeout(() => this.raiseActiveIframeWindow(), 50);
    if (!this.framePoll) {
      this.framePoll = setInterval(() => this.raiseActiveIframeWindow(), 300);
    }
  };
  private readonly onWindowFocus = () => {
    if (this.framePoll) {
      clearInterval(this.framePoll);
      this.framePoll = null;
    }
    this.lastFrameEl = null;
  };
  private raiseActiveIframeWindow() {
    const el = document.activeElement;
    if (!(el instanceof HTMLIFrameElement) || el === this.lastFrameEl) {
      return;
    }
    this.lastFrameEl = el;
    const id = el.closest('.dock-window')?.getAttribute('data-window');
    const win = id ? this.windows.find((w) => w.id === id) : null;
    if (win && win.z !== this.zTop - 1) {
      win.z = this.zTop++;
      this.requestRender();
    }
  }

  // ---------------------------------------------------------- floating windows

  /** Lift a panel out of the dock into a floating dialog. */
  floatPanel(panelId: string, rect?: Partial<Rect>): FloatingWindow | null {
    const def = this.defs.get(panelId);
    if (!def || !this.canFloat(panelId)) {
      return null;
    }
    if (this.isOpen(panelId) && this.isNodeLocked(L.findTabsWithPanel(this.root, panelId)?.id)) {
      return null;
    }

    // remember where it was docked so docking the window back returns it there
    const source = this.nodeOf(panelId);
    if (source) {
      this.lastLocation.set(panelId, source);
    }
    this.detach(panelId);
    const min = this.minOf(L.tabs([panelId]));
    const bounds = this.container?.getBoundingClientRect();
    const width = Math.max(rect?.width ?? this.defaultWindowSize.width, min.width);
    const height = Math.max(rect?.height ?? this.defaultWindowSize.height, min.height + this.windowBarHeight);

    const win: FloatingWindow = {
      id: L.uid('w'),
      node: L.tabs([panelId]),
      x: Math.max(0, rect?.x ?? (bounds ? (bounds.width - width) / 2 : 40)),
      y: Math.max(0, rect?.y ?? (bounds ? (bounds.height - height) / 3 : 40)),
      width,
      height,
      z: this.zTop++,
    };
    this.windows = [...this.windows, this.clampWindow(win)];
    this.commit();
    return win;
  }

  /** Send a whole window back into the dock — each panel returns to where it
   *  was docked before floating, when that node still exists. */
  dockWindow(windowId: string, targetNodeId?: string) {
    const win = this.windows.find((w) => w.id === windowId);
    if (!win) {
      return;
    }
    const panels = L.allPanels(win.node);
    this.windows = this.windows.filter((w) => w.id !== windowId);
    for (const p of panels) {
      const remembered = this.lastLocation.get(p);
      // fallback is the panel's declared home side (recreated if pruned),
      // then the right column — away from the hierarchy's usual left column
      const home = this.defs.get(p)?.home;
      const target =
        targetNodeId ??
        (remembered && this.findNodeAnywhere(remembered) && this.canDockInto(p, remembered) ? remembered : undefined) ??
        (home ? this.ensureHomeNode(home) : undefined) ??
        this.ensureHomeNode('right') ??
        this.defaultDropTarget()?.id;
      if (target) {
        this.insertInto(target, p);
      } else {
        this.root = L.isEmpty(this.root) ? L.tabs([p]) : win.node;
      }
    }
    this.commit();
  }

  closeWindow(windowId: string) {
    const win = this.windows.find((w) => w.id === windowId);
    if (!win) {
      return;
    }
    for (const p of L.allPanels(win.node)) {
      this.closePanel(p);
    }
    this.windows = this.windows.filter((w) => w.id !== windowId);
    this.commit();
  }

  // -------------------------------------------------------------------- state

  saveLayout(): DockState {
    // a panel hidden for a deferred close is already gone as far as a saved
    // layout is concerned
    let root = L.cloneLayout(this.root);
    let windows = this.windows.map((w) => ({ ...w, node: L.cloneLayout(w.node) }));
    for (const id of this.closing) {
      root = L.removePanel(root, id);
      windows = windows.map((w) => ({ ...w, node: L.removePanel(w.node, id) })).filter((w) => !L.isEmpty(w.node));
    }
    return { root, windows };
  }

  loadLayout(state: DockState | LayoutNode) {
    const next: DockState = 'root' in state ? state : { root: state, windows: [] };
    // A restored layout can't legitimately be missing locked furniture (the
    // ribbon strip): heal it against the default before adopting, or a stale
    // save leaves ribbons gone until the user hits Reset.
    next.root = L.healFurniture(next.root, this.initialLayout);
    // pre-cascade snapshots may carry the removed pushMode field — strip it
    const strip = (n: LayoutNode) =>
      L.walk(n, (nd) => {
        delete (nd as { pushMode?: unknown }).pushMode;
      });
    strip(next.root);
    for (const w of next.windows) {
      strip(w.node);
    }
    next.root = L.normalizeLayout(next.root);
    for (const w of next.windows) {
      w.node = L.normalizeLayout(w.node);
    }
    // the new layout decides: a panel it keeps shows again, one it drops is
    // unmounted now — a wait in progress is over either way
    this.closing.clear();
    const keep = new Set([...L.allPanels(next.root), ...next.windows.flatMap((w) => L.allPanels(w.node))]);
    for (const [id, host] of this.hosts) {
      if (!keep.has(id)) {
        host.dispose?.();
        host.el.remove();
        this.hosts.delete(id);
      }
    }
    this.root = next.root;
    this.windows = next.windows;
    for (const w of this.windows) {
      this.zTop = Math.max(this.zTop, w.z + 1);
    }
    this.commit();
  }

  // ------------------------------------------------------------- tree plumbing

  private trees(): LayoutNode[] {
    return [this.root, ...this.windows.map((w) => w.node)];
  }

  private findNodeAnywhere(id: string): LayoutNode | null {
    for (const tree of this.trees()) {
      const found = L.findNode(tree, id);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /** Rewrite whichever tree (dock or window) contains `nodeId`. */
  private editTreeWith(nodeId: string, fn: (tree: LayoutNode) => LayoutNode): boolean {
    if (L.findNode(this.root, nodeId)) {
      this.root = fn(this.root);
      return true;
    }
    const i = this.windows.findIndex((w) => L.findNode(w.node, nodeId));
    if (i < 0) {
      return false;
    }
    this.windows = this.windows.map((w, j) => (j === i ? { ...w, node: fn(w.node) } : w));
    return true;
  }

  /** Pull a panel out of the dock and every window, dropping windows left empty. */
  private detach(panelId: string) {
    this.root = L.removePanel(this.root, panelId);
    this.windows = this.windows
      .map((w) => ({ ...w, node: L.removePanel(w.node, panelId) }))
      .filter((w) => !L.isEmpty(w.node));
  }

  /** Return the soft-home node id, recreating a well-known side node
   *  ('left' / 'right' / 'bottom') when it was pruned after its last panel
   *  closed. Sides rejoin the outermost row split (or wrap the root). */
  private ensureHomeNode(homeId: string): string | null {
    if (this.findNodeAnywhere(homeId)) {
      return homeId;
    }
    if (homeId !== 'left' && homeId !== 'right' && homeId !== 'bottom') {
      return null;
    }
    const dir = homeId === 'bottom' ? 'column' : 'row';
    // Stay inside the dockable region: locked furniture (the ribbon strip)
    // must remain outermost and never gain a sibling. After solo prunes the
    // side columns the layout can be ribbon-over-viewport with no row split —
    // wrapping the ROOT there would put the new column beside the ribbon.
    const region = L.dockRegion(this.root);
    const node = L.tabs([], { id: homeId, ...(homeId === 'bottom' ? { fixedSize: 170 } : {}) });
    // 'bottom' belongs directly UNDER the central leaf (the viewport), not at
    // the foot of whatever column split happens to exist (e.g. the left one).
    if (homeId === 'bottom') {
      const central = this.centralLeaf();
      if (central && L.findNode(this.root, central.id)) {
        this.root = L.replaceNode(this.root, central.id, (n) => {
          const inheritedFixed = n.fixedSize;
          return L.split(
            'column',
            [{ ...n, fixedSize: undefined }, node],
            [1, 1],
            inheritedFixed != null ? { fixedSize: inheritedFixed } : {},
          );
        });
        return homeId;
      }
    }
    let host: SplitNode | null = null;
    L.walk(region, (n) => {
      if (!host && n.type === 'split' && n.direction === dir) {
        host = n;
      }
    });
    if (host) {
      const h: SplitNode = host;
      const total = h.sizes.reduce((a, b) => a + b, 0) || h.children.length;
      const size = total * 0.25;
      if (homeId === 'left') {
        h.children.unshift(node);
        h.sizes.unshift(size);
      } else {
        h.children.push(node);
        h.sizes.push(size);
      }
    } else {
      const wrap = (r: LayoutNode) =>
        homeId === 'left' ? L.split(dir, [node, r], [25, 75]) : L.split(dir, [r, node], [75, 25]);
      this.root = region === this.root ? wrap(this.root) : L.replaceNode(this.root, region.id, wrap);
    }
    return homeId;
  }

  private insertInto(nodeId: string, panelId: string, tabIndex?: number) {
    this.editTreeWith(nodeId, (tree) => L.insertIntoTabs(tree, nodeId, panelId, tabIndex));
  }

  private isNodeLocked(nodeId?: string): boolean {
    if (!nodeId) {
      return false;
    }
    const tree = this.trees().find((t) => L.findNode(t, nodeId));
    return tree ? L.isLocked(tree, nodeId) : false;
  }

  private defaultDropTarget(): TabsNode | null {
    let best: TabsNode | null = null;
    L.walk(this.root, (n) => {
      if (!best && n.type === 'tabs' && !L.isLocked(this.root, n.id)) {
        best = n;
      }
    });
    return best;
  }

  // ------------------------------------------------------------------ measuring

  private env: L.MeasureEnv = {
    headerHeight: 0,
    splitterSize: 0,
    panelMin: (id) => this.panelMin(id),
    stripHeight: (nodeId) => this.stripHeights.get(nodeId) ?? this.headerHeight,
  };

  private panelMin(id: string): Size {
    const def = this.defs.get(id);
    const rt = this.runtimeMin.get(id);
    return {
      // A panel is never narrower than its own tab, or the strip would clip it.
      width: Math.max(rt?.width ?? def?.minWidth ?? 120, this.tabMin(id) + 16),
      height: rt?.height ?? def?.minHeight ?? 60,
    };
  }

  private minOf(node: LayoutNode): Size {
    this.env.headerHeight = this.headerHeight;
    this.env.splitterSize = this.splitterSize;
    return L.measureMin(node, this.env);
  }

  private clampWindow(win: FloatingWindow): FloatingWindow {
    const bounds = this.container?.getBoundingClientRect();
    if (!bounds) {
      return win;
    }
    // Keep the title bar reachable: never let a window leave the dock entirely.
    const x = Math.min(Math.max(win.x, 40 - win.width), bounds.width - 40);
    const y = Math.min(Math.max(win.y, 0), bounds.height - this.windowBarHeight);
    return { ...win, x, y };
  }

  private commit() {
    // keep the tree flat where it looks flat — cascades walk real siblings
    this.root = L.normalizeLayout(this.root);
    for (const w of this.windows) {
      w.node = L.normalizeLayout(w.node);
    }
    this.version++;
    this.requestRender();
    for (const fn of this.listeners) {
      fn();
    }
  }

  requestRender() {
    if (this.frame || !this.container) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  // ---------------------------------------------------------------- rendering

  private renderNow() {
    if (!this.container) {
      return;
    }
    render(this.template(), this.container);
    this.watchStrips();
  }

  /**
   * Keep every tab strip under a ResizeObserver. A strip whose tabs wrapped
   * onto extra rows is taller than `headerHeight`, and measureMin folds the
   * MEASURED height into the group's minimum — so the wrapped rows raise the
   * group's floor instead of squeezing the panel body below its own minimum.
   * Observing is idempotent, so re-running it after every render costs
   * nothing; a strip that is gone loses its entry.
   */
  private watchStrips() {
    if (!this.container || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.stripObserver ??= new ResizeObserver((entries) => this.onStripResize(entries));
    const seen = new Set<string>();
    for (const el of this.container.querySelectorAll<HTMLElement>('.dock-tabstrip[data-node]')) {
      const id = el.dataset.node;
      if (!id) {
        continue;
      }
      seen.add(id);
      this.stripObserver.observe(el);
    }
    let dropped = false;
    for (const id of [...this.stripHeights.keys()]) {
      if (!seen.has(id)) {
        this.stripHeights.delete(id);
        dropped = true;
      }
    }
    if (dropped) {
      this.requestRender();
    }
  }

  /** Whether a strip's tabs have wrapped onto more than one row (the measured
   *  height cleared one row plus its gap) — such a strip boxes its tabs, or
   *  the rows read as one run-on line of labels. */
  private stripWrapped(nodeId: string): boolean {
    return (this.stripHeights.get(nodeId) ?? 0) > this.headerHeight + 2;
  }

  /** A strip changed height: remember it and re-render so the new minimum
   *  reaches the slot styles. Zero heights (a strip inside a hidden subtree)
   *  are ignored — they would drop the group's floor to nothing. */
  private onStripResize(entries: ResizeObserverEntry[]) {
    let changed = false;
    for (const e of entries) {
      const el = e.target;
      if (!(el instanceof HTMLElement)) {
        continue;
      }
      const id = el.dataset.node;
      const h = Math.round(e.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height);
      if (!id || h <= 0) {
        continue;
      }
      if (this.stripHeights.get(id) !== h) {
        this.stripHeights.set(id, h);
        changed = true;
      }
    }
    if (changed) {
      this.requestRender();
    }
  }

  private template(): TemplateResult {
    // Raise order is stored as an ever-growing counter; flatten it to 0..n here
    // so windows never climb above the drag chrome.
    const order = new Map([...this.windows].sort((a, b) => a.z - b.z).map((w, i) => [w.id, i]));
    // When pruning leaves a fixed-size node (e.g. the ribbon) as the sole root,
    // honor its size instead of stretching it to fill — the space below stays
    // empty, exactly as if a flexible sibling had been there.
    const root = this.root;
    const surface =
      root.fixedSize != null
        ? html`<div class="dock-surface dock-surface--fixed">
            <div
              class="dock-fixed-root"
              style=${styleMap({ height: `${root.fixedSize}px`, minHeight: `${root.fixedSize}px` })}
            >
              ${this.nodeTpl(root)}
            </div>
          </div>`
        : html`<div class="dock-surface">${this.nodeTpl(root)}</div>`;
    return html`
      ${surface}
      ${repeat(
        this.windows,
        (w) => w.id,
        (w) => this.windowTpl(w, order.get(w.id) ?? 0),
      )}
      ${this.dropIndicator()}
    `;
  }

  /**
   * `axis` is the direction along which this node would free up space if it
   * collapsed — its parent's direction, except inside a fully collapsed subtree,
   * where the whole subtree collapses as one and the axis passes straight
   * through. That's what turns a column of two collapsed panels into a single
   * narrow rail of two vertical labels, rather than a wide stack of strips.
   */
  private nodeTpl(node: LayoutNode, axis: 'row' | 'column' = 'column'): TemplateResult {
    return node.type === 'split' ? this.splitTpl(node, axis) : this.tabsTpl(node, axis);
  }

  private slotStyle(child: LayoutNode, size: number, axis: 'row' | 'column', shrink: boolean) {
    const min = this.minOf(child);
    // A collapsed child is exactly its strip — but only when it has expanded
    // siblings to hand the space to. Inside a fully collapsed subtree, the
    // strips share the space instead, so their labels stay readable.
    const collapsed = shrink && L.isCollapsedTree(child);
    const fixed = collapsed ? this.headerHeight : child.fixedSize;
    if (fixed != null) {
      return styleMap({
        flex: `0 0 ${fixed}px`,
        minWidth: axis === 'row' ? `${fixed}px` : `${min.width}px`,
        minHeight: axis === 'column' ? `${fixed}px` : `${min.height}px`,
      });
    }
    return styleMap({ flex: `${size} 1 0`, minWidth: `${min.width}px`, minHeight: `${min.height}px` });
  }

  private splitTpl(node: SplitNode, parentAxis: 'row' | 'column'): TemplateResult {
    const axis = node.direction;
    // If everything inside is collapsed, this split collapses as a unit: its
    // children keep the parent's axis and share the space along ours.
    const whole = L.isCollapsedTree(node);
    const childAxis = whole ? parentAxis : axis;
    const parts: unknown[] = [];

    node.children.forEach((child, i) => {
      if (i > 0) {
        // live while ANY child on each side can resize — the cascade passes
        // through rigid neighbours (collapsed groups, size-locked blocks)
        const canYield = (n: LayoutNode, j: number) => !this.rigidInDrag(n, j === i - 1 || j === i);
        const inert =
          !!node.locked ||
          !node.children.some((n, j) => j < i && canYield(n, j)) ||
          !node.children.some((n, j) => j >= i && canYield(n, j));
        parts.push(html`
          <div
            class=${classMap({ 'dock-splitter': true, [`dock-splitter--${axis}`]: true, 'is-inert': inert })}
            style=${styleMap({ flex: `0 0 ${this.splitterSize}px` })}
            @pointerdown=${(e: PointerEvent) => {
              if (!inert) {
                this.startResize(e, node, i - 1);
              }
            }}
          ></div>
        `);
      }
      parts.push(html`
        <div class="dock-slot" style=${this.slotStyle(child, node.sizes[i] ?? 1, axis, !whole)}>
          ${this.nodeTpl(child, childAxis)}
        </div>
      `);
    });

    return html`<div
      class=${classMap({ 'dock-split': true, [`dock-split--${axis}`]: true, 'is-collapsed': whole })}
      data-node=${node.id}
    >
      ${parts}
    </div>`;
  }

  private tabsTpl(node: TabsNode, axis: 'row' | 'column'): TemplateResult {
    const locked = this.isNodeLocked(node.id);
    const collapsible =
      node.collapsible === true ? !node.hideTabs : node.collapsible !== false && !locked && !node.hideTabs;

    // Collapsed inside a row: a vertical rail. Click a label to open it back up.
    if (node.collapsed && axis === 'row') {
      return html`
        <section class="dock-tabs is-collapsed is-rail" data-node=${node.id}>
          <button
            class="dock-collapse"
            title="Expand"
            aria-label="Expand panel"
            @click=${() => this.setCollapsed(node.id, false)}
          >
            ›
          </button>
          <div class="dock-rail-tabs">
            ${repeat(
              this.shownPanels(node),
              (id) => id,
              (id) => html`
                <button
                  class=${classMap({ 'dock-rail-tab': true, 'is-active': id === node.activePanel })}
                  @click=${() => this.focusPanel(id)}
                >
                  ${this.title(id)}
                </button>
              `,
            )}
          </div>
        </section>
      `;
    }

    const shown = this.shownPanels(node);
    const active = node.activePanel && shown.includes(node.activePanel) ? node.activePanel : shown[0];

    // Collapsed inside a column: just the strip, nothing under it.
    const bodies = node.collapsed
      ? []
      : node.panels.map((id) => {
          const el = this.hostFor(id);
          el.style.display = id === active ? '' : 'none';
          return el;
        });

    return html`
      <section
        class=${classMap({
          'dock-tabs': true,
          'is-locked': locked,
          'is-empty': node.panels.length === 0,
          'is-collapsed': !!node.collapsed,
        })}
        data-node=${node.id}
        data-dock-target=${locked || node.collapsed ? nothing : '1'}
      >
        ${
          node.hideTabs
            ? nothing
            : html`
              <header
                class=${classMap({ 'dock-tabstrip': true, 'is-wrapped': this.stripWrapped(node.id) })}
                role="tablist"
                data-node=${node.id}
                style=${styleMap({ minHeight: `${this.headerHeight}px`, '--dock-header-h': `${this.headerHeight}px` })}
              >
                ${repeat(
                  shown,
                  (id) => id,
                  (id, i) => this.tabTpl(id, i, id === active, locked),
                )}
                <div class="dock-tabstrip-fill"></div>
                <div class="dock-strip-actions" style=${styleMap({ height: `${this.headerHeight}px` })}>
                ${
                  collapsible && !locked
                    ? html`<button
                      class="dock-collapse"
                      data-tooltip=${
                        node.sizeLocked
                          ? 'Size lock: ON — the size it was locked at is its minimum; it can grow but never shrinks below it, so drags cascade straight past. Click to unlock'
                          : 'Size lock: OFF — the group resizes normally. Click to make its current size the minimum'
                      }
                      style=${styleMap(
                        // emoji ignore CSS color — OFF must be unmistakably
                        // different from ON, so it renders gray and faded
                        node.sizeLocked ? {} : { filter: 'grayscale(1)', opacity: '0.4' },
                      )}
                      aria-label="Toggle size lock"
                      aria-pressed=${!!node.sizeLocked}
                      @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
                      @click=${() => this.toggleSizeLock(node.id)}
                    >
                      ${node.sizeLocked ? '🔒' : '🔓'}
                    </button>`
                    : nothing
                }
                ${
                  collapsible
                    ? html`<button
                      class="dock-collapse"
                      data-tooltip=${node.collapsed ? 'Expand' : 'Collapse'}
                      aria-label=${node.collapsed ? 'Expand panel' : 'Collapse panel'}
                      aria-expanded=${!node.collapsed}
                      @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
                      @click=${() => this.toggleCollapse(node.id)}
                    >
                      ${node.collapsed ? '▸' : '▾'}
                    </button>`
                    : nothing
                }
                </div>
              </header>
            `
        }
        ${
          node.collapsed
            ? nothing
            : html`
              <div class="dock-bodies">
                ${node.panels.length === 0 ? html`<p class="dock-empty">Drag a panel here.</p>` : nothing}
                ${repeat(
                  bodies,
                  (el) => el.dataset.panel,
                  (el) => el,
                )}
              </div>
            `
        }
      </section>
    `;
  }

  private tabTpl(id: string, index: number, active: boolean, locked: boolean): TemplateResult {
    const def = this.defs.get(id);
    const closable = !locked && def?.closable !== false;
    return html`
      <button
        class=${classMap({ 'dock-tab': true, 'is-active': active, 'is-sized': this.tabMin(id) > 0 })}
        style=${styleMap(this.tabMin(id) > 0 ? { minWidth: `${this.tabMin(id)}px` } : {})}
        role="tab"
        aria-selected=${active}
        data-tab=${id}
        data-tab-index=${index}
        @pointerdown=${(e: PointerEvent) => {
          this.focusPanel(id);
          if (!locked) {
            this.startPanelDrag(e, id);
          }
        }}
        @dblclick=${() => {
          if (!locked && this.canFloat(id)) {
            this.floatPanel(id);
          }
        }}
      >
        <span class="dock-tab-label">${this.title(id)}</span>
        ${
          closable
            ? html`<span
              class="dock-tab-close"
              role="button"
              aria-label=${`Close ${this.title(id)}`}
              @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
              @click=${(e: MouseEvent) => {
                e.stopPropagation();
                this.closePanel(id);
              }}
              >×</span
            >`
            : nothing
        }
      </button>
    `;
  }

  private windowTpl(win: FloatingWindow, depth: number): TemplateResult {
    const min = this.minOf(win.node);
    const titles = L.allPanels(win.node)
      .filter((p) => !this.closing.has(p))
      .map((p) => this.title(p));
    const handles: Array<[string, WindowDrag['edges']]> = [
      ['n', { n: true, s: false, e: false, w: false }],
      ['s', { n: false, s: true, e: false, w: false }],
      ['e', { n: false, s: false, e: true, w: false }],
      ['w', { n: false, s: false, e: false, w: true }],
      ['ne', { n: true, s: false, e: true, w: false }],
      ['nw', { n: true, s: false, e: false, w: true }],
      ['se', { n: false, s: true, e: true, w: false }],
      ['sw', { n: false, s: true, e: false, w: true }],
    ];

    return html`
      <div
        class="dock-window"
        data-window=${win.id}
        style=${styleMap({
          left: `${win.x}px`,
          top: `${win.y}px`,
          width: `${Math.max(win.width, min.width)}px`,
          height: win.minimized ? 'auto' : `${Math.max(win.height, min.height + this.windowBarHeight)}px`,
          zIndex: String(10 + depth),
        })}
        @pointerdown=${() => {
          if (win.z !== this.zTop - 1) {
            win.z = this.zTop++;
            this.requestRender();
          }
        }}
      >
        <header
          class="dock-window-bar"
          style=${styleMap({ height: `${this.windowBarHeight}px` })}
          @pointerdown=${(e: PointerEvent) => this.startWindowDrag(e, win, 'move')}
          @dblclick=${() => this.dockWindow(win.id)}
        >
          <span class="dock-window-title">${titles.join(', ')}</span>
          <button
            class="dock-window-btn"
            title=${win.minimized ? 'Restore' : 'Minimize'}
            aria-label=${win.minimized ? 'Restore window' : 'Minimize window'}
            @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
            @click=${() => this.minimizeWindow(win.id, !win.minimized)}
          >
            ${win.minimized ? '❐' : '–'}
          </button>
          <button
            class="dock-window-btn"
            title="Dock back"
            aria-label="Dock back"
            @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
            @click=${() => this.dockWindow(win.id)}
          >
            ⤓
          </button>
          <button
            class="dock-window-btn"
            title="Close"
            aria-label="Close window"
            @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
            @click=${() => this.closeWindow(win.id)}
          >
            ×
          </button>
        </header>
        <div class="dock-window-body" style=${styleMap(win.minimized ? { display: 'none' } : {})}>
          ${this.nodeTpl(win.node, 'column')}
        </div>
        ${
          win.minimized
            ? nothing
            : handles.map(
                ([name, edges]) => html`
            <div
              class="dock-window-grip dock-window-grip--${name}"
              @pointerdown=${(e: PointerEvent) => this.startWindowDrag(e, win, 'resize', edges)}
            ></div>
          `,
              )
        }
      </div>
    `;
  }

  /** Collapse a floating window to its title bar, or restore it. */
  minimizeWindow(windowId: string, minimized = true) {
    const win = this.windows.find((w) => w.id === windowId);
    if (!win || !!win.minimized === minimized) {
      return;
    }
    win.minimized = minimized;
    this.commit();
  }

  /* --------------------------------------------------------------- permissions */

  /** Nodes this panel is pinned to, if any. */
  private homeOf(panelId: string): string[] | null {
    const spec = this.defs.get(panelId)?.dockableIn;
    if (spec == null) {
      return null;
    }
    return Array.isArray(spec) ? spec : [spec];
  }

  /** May this panel be dropped into this node? */
  canDockInto(panelId: string, nodeId: string): boolean {
    if (this.isNodeLocked(nodeId)) {
      return false;
    }
    const home = this.homeOf(panelId);
    return home ? home.includes(nodeId) : true;
  }

  /** A pinned panel never leaves its node, so it can never float or split out. */
  canLeaveHome(panelId: string): boolean {
    return this.homeOf(panelId) === null;
  }

  canFloat(panelId: string): boolean {
    return this.defs.get(panelId)?.floatable !== false && this.canLeaveHome(panelId);
  }

  /** Minimum width of a panel's tab button. */
  private tabMin(panelId: string): number {
    return this.defs.get(panelId)?.tabMinWidth ?? this.tabMinWidth;
  }

  /* ------------------------------------------------------------ no-op analysis */
  /* A drop that would put the panel back exactly where it already is isn't a
     drop. We work that out up front and never offer it: the compass button is
     dimmed and unclickable, the hint doesn't draw, the preview stays away. */

  private sourceOf(panelId: string) {
    for (const tree of this.trees()) {
      const node = L.findTabsWithPanel(tree, panelId);
      if (node) {
        return { tree, node, parent: L.findParent(tree, node.id), sole: node.panels.length === 1 };
      }
    }
    return null;
  }

  /** Already alone in its own window — floating it again would do nothing. */
  private isSoleFloating(panelId: string): boolean {
    return this.windows.some((w) => {
      const panels = L.allPanels(w.node);
      return panels.length === 1 && panels[0] === panelId;
    });
  }

  /** Compass zones that would be a no-op for this panel. */
  private deadZones(panelId: string): Set<string> {
    const dead = new Set<string>();
    const src = this.sourceOf(panelId);
    if (!src) {
      return dead;
    }

    // Pinned panels can't create new nodes, so every edge is out; the centre only
    // survives if the main panel happens to be one of their homes.
    if (!this.canLeaveHome(panelId)) {
      for (const z of ['left', 'right', 'top', 'bottom'] as const) {
        dead.add(z);
      }
      const main = this.centralLeaf();
      if (!main || !this.canDockInto(panelId, main.id)) {
        dead.add('center');
      }
      return dead;
    }

    // Already a tab of the main panel → 'center' changes nothing.
    const central = this.centralLeaf();
    if (central && src.node.id === central.id) {
      dead.add('center');
    }

    // Already the outermost child on that side of the dock area.
    const region = L.dockRegion(this.root);
    if (src.sole && region.type === 'split' && src.parent?.id === region.id) {
      const i = region.children.findIndex((c) => c.id === src.node.id);
      const first = region.children.findIndex((c) => !c.locked);
      const last = region.children.length - 1 - [...region.children].reverse().findIndex((c) => !c.locked);
      if (region.direction === 'row') {
        if (i === first) {
          dead.add('left');
        }
        if (i === last) {
          dead.add('right');
        }
      } else {
        if (i === first) {
          dead.add('top');
        }
        if (i === last) {
          dead.add('bottom');
        }
      }
    }
    return dead;
  }

  /** Tabbing into a strip — same strip, same slot? */
  private tabIsNoop(panelId: string, nodeId: string, tabIndex?: number): boolean {
    const src = this.sourceOf(panelId);
    if (!src || src.node.id !== nodeId) {
      return false;
    }
    if (src.sole || tabIndex == null) {
      return true;
    }
    const i = src.node.panels.indexOf(panelId);
    return tabIndex === i || tabIndex === i + 1;
  }

  /** The dockable area (everything but locked furniture) and its live rect. */
  private regionRect(): { id: string; rect: DOMRect } | null {
    const region = L.dockRegion(this.root);
    const el = this.container?.querySelector<HTMLElement>(`.dock-surface [data-node="${region.id}"]`);
    return el ? { id: region.id, rect: el.getBoundingClientRect() } : null;
  }

  /** The biggest leaf in the dock — what "center" means on the compass. */
  private centralLeaf(): { id: string; rect: DOMRect } | null {
    const els = [...(this.container?.querySelectorAll<HTMLElement>('.dock-surface [data-dock-target="1"]') ?? [])];
    let best: { id: string; rect: DOMRect } | null = null;
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (!best || rect.width * rect.height > best.rect.width * best.rect.height) {
        best = { id: el.dataset.node!, rect };
      }
    }
    return best;
  }

  /**
   * Where an outer-ring compass button would dock: beside the dock region's
   * TOP-LEVEL child containing the anchored panel — a full-band "in between"
   * drop (e.g. a new column between the center and the right column) — falling
   * back to the region edge when the region isn't a split along that axis.
   * Null when the drop would change nothing: the anchored panel already spans
   * that whole child (an inner split gives the same layout), or the dragged
   * panel already sits alone on that side.
   */
  private outerSpot(
    anchorNodeId: string,
    zone: L.SplitZone,
    panelId: string,
  ): { nodeId: string; inner: boolean; preview: Box } | null {
    const dir = zone === 'left' || zone === 'right' ? 'row' : 'column';
    const before = zone === 'left' || zone === 'top';
    // The anchor's OWN tree bounds the outer ring: for a panel in a floating
    // window "beside" means beside within that window — never the main dock.
    const win = this.windows.find((w) => L.findNode(w.node, anchorNodeId));
    if (!win && !L.findNode(this.root, anchorNodeId)) {
      return null;
    }
    const region = L.dockRegion(win ? win.node : this.root);

    // The OUTERMOST split along this axis that contains the anchor, and its
    // child holding the anchor — that's the widest "in between" boundary.
    const descend = (n: LayoutNode): { host: SplitNode; child: LayoutNode } | null => {
      if (n.type !== 'split') {
        return null;
      }
      if (n.direction === dir) {
        const c = n.children.find((c) => c.id === anchorNodeId || L.findNode(c, anchorNodeId));
        if (c) {
          return { host: n, child: c }; // outermost match wins
        }
      }
      for (const c of n.children) {
        if (L.findNode(c, anchorNodeId)) {
          const found = descend(c);
          if (found) {
            return found;
          }
        }
      }
      return null;
    };
    const boundary = descend(region);

    const h = boundary?.host ?? null;
    const c = boundary?.child ?? null;
    if (h && c && c.id !== anchorNodeId) {
      const nb = h.children[h.children.indexOf(c) + (before ? -1 : 1)];
      if (nb?.type === 'tabs' && nb.panels.length === 1 && nb.panels[0] === panelId) {
        return null; // already there
      }
      const el = this.container?.querySelector<HTMLElement>(`[data-node="${c.id}"]`);
      if (el) {
        return { nodeId: c.id, inner: true, preview: this.edgeBox(el.getBoundingClientRect(), zone) };
      }
    }
    // The anchored panel spans its whole slot (the nearest boundary would
    // equal the inner split), or there is no split along this axis at all:
    // fall out to the REGION edge — but only when the panel actually touches
    // that edge and the edge band is a different size than the panel (e.g.
    // full-width below the Console, full-width above the Hierarchy — but NOT
    // above the Console, where the viewport sits in between).
    if (h && c?.id === anchorNodeId && !this.touchesRegionEdge(region, anchorNodeId, zone)) {
      return null;
    }
    if (!win && this.deadZones(panelId).has(zone)) {
      return null; // deadZones reasons about the MAIN dock
    }
    const regionEl = this.container?.querySelector<HTMLElement>(`[data-node="${region.id}"]`);
    const r = regionEl ? { id: region.id, rect: regionEl.getBoundingClientRect() } : null;
    if (!r) {
      return null;
    }
    const anchorEl = this.container?.querySelector<HTMLElement>(`[data-node="${anchorNodeId}"]`);
    if (h && c?.id === anchorNodeId) {
      const a = anchorEl?.getBoundingClientRect();
      const sameSize =
        a && (dir === 'row' ? Math.abs(a.height - r.rect.height) < 1 : Math.abs(a.width - r.rect.width) < 1);
      if (!a || sameSize) {
        return null; // edge drop would equal the inner split
      }
    }
    return { nodeId: r.id, inner: false, preview: this.edgeBox(r.rect, zone) };
  }

  /** Does the anchor's slot touch the region's `zone` edge? True when the
   *  anchor is the outermost child of every same-axis split on the way down. */
  private touchesRegionEdge(region: LayoutNode, anchorNodeId: string, zone: L.SplitZone): boolean {
    const dir = zone === 'left' || zone === 'right' ? 'row' : 'column';
    const before = zone === 'left' || zone === 'top';
    let n: LayoutNode = region;
    while (n.id !== anchorNodeId) {
      if (n.type !== 'split') {
        return false;
      }
      const idx = n.children.findIndex((ch) => ch.id === anchorNodeId || L.findNode(ch, anchorNodeId));
      if (idx < 0) {
        return false;
      }
      if (n.direction === dir && idx !== (before ? 0 : n.children.length - 1)) {
        return false;
      }
      n = n.children[idx];
    }
    return true;
  }

  /** The strip a compass edge button would claim. */
  private edgeBox(region: DOMRect, zone: Exclude<DropZone, 'float' | 'center'>): Box {
    const w = Math.max(90, region.width * 0.28);
    const h = Math.max(70, region.height * 0.28);
    if (zone === 'left') {
      return { left: region.left, top: region.top, width: w, height: region.height };
    }
    if (zone === 'right') {
      return { left: region.right - w, top: region.top, width: w, height: region.height };
    }
    if (zone === 'top') {
      return { left: region.left, top: region.top, width: region.width, height: h };
    }
    return { left: region.left, top: region.bottom - h, width: region.width, height: h };
  }

  /**
   * The dock compass. Anchored to the panel under the pointer when there is
   * one: center = add as a tab THERE, the four directions split THAT panel.
   * Over empty furniture it anchors to the whole dock area instead (edge
   * docking, center = tab into the main panel). Dropping outside everything
   * still pops the panel out into a floating dialog.
   */
  private compassTpl(target: DropTarget, base: DOMRect, panelId: string): TemplateResult | typeof nothing {
    const anchor = this.drag?.kind === 'panel' ? (this.drag.anchor ?? null) : null;
    const region = this.regionRect();
    const r = anchor?.rect ?? region?.rect;
    if (!r) {
      return nothing;
    }
    const overPanel = anchor != null;

    const btn = this.coarse ? 44 : 34;
    const gap = this.coarse ? 6 : 4;
    const step = btn + gap;
    const cx = r.left - base.left + r.width / 2;
    const cy = r.top - base.top + r.height / 2;

    interface CompassBtn {
      zone: Exclude<DropZone, 'float'>;
      dx: number;
      dy: number;
      label: string;
      outer?: boolean;
    }
    const buttons: CompassBtn[] = [
      { zone: 'center', dx: 0, dy: 0, label: overPanel ? 'Add as a tab here' : 'Add to the main panel as a tab' },
      { zone: 'left', dx: -step, dy: 0, label: overPanel ? 'Split this panel left' : 'Dock left' },
      { zone: 'right', dx: step, dy: 0, label: overPanel ? 'Split this panel right' : 'Dock right' },
      { zone: 'top', dx: 0, dy: -step, label: overPanel ? 'Split this panel top' : 'Dock top' },
      { zone: 'bottom', dx: 0, dy: step, label: overPanel ? 'Split this panel bottom' : 'Dock bottom' },
    ];
    // Anchored to a panel, a second OUTER ring drops IN BETWEEN: beside the
    // top-level column/row holding the hovered panel (falling back to the dock
    // edge) — inner ring splits the hovered panel itself.
    const btnOut = Math.round((btn * 2) / 3); // outer ring: smaller, takes less space
    const outerOff = step + (btn + btnOut) / 2 + gap;
    if (overPanel) {
      buttons.push(
        { zone: 'left', dx: -outerOff, dy: 0, label: 'Dock beside, to the left', outer: true },
        { zone: 'right', dx: outerOff, dy: 0, label: 'Dock beside, to the right', outer: true },
        { zone: 'top', dx: 0, dy: -outerOff, label: 'Dock beside, above', outer: true },
        { zone: 'bottom', dx: 0, dy: outerOff, label: 'Dock beside, below', outer: true },
      );
    }
    const edgeDead = this.deadZones(panelId); // anchor-less buttons
    const isDead = (b: CompassBtn) =>
      b.outer
        ? !anchor || this.outerSpot(anchor.nodeId, b.zone as L.SplitZone, panelId) == null
        : overPanel
          ? false
          : edgeDead.has(b.zone);
    const isHot = (b: CompassBtn) =>
      target.kind === 'dock' && target.zone === b.zone && (b.zone === 'center' || !!target.outer === !!b.outer);

    const pad = gap * 2;
    const reach = overPanel ? (outerOff + btnOut / 2) * 2 - btn : step * 2;
    return html`
      <div class="dock-compass" style=${styleMap({ left: `${cx}px`, top: `${cy}px` })}>
        <div
          class="dock-compass-rose"
          style=${styleMap({
            width: `${reach + btn + pad * 2}px`,
            height: `${reach + btn + pad * 2}px`,
          })}
        ></div>
        ${buttons.map(
          (b) => html`
            <div
              class=${classMap({
                'dock-compass-btn': true,
                [`dock-compass-btn--${b.zone}`]: true,
                'dock-compass-btn--outer': !!b.outer,
                'is-hot': isHot(b),
                'is-off': isDead(b),
              })}
              data-drop-zone=${isDead(b) ? nothing : b.zone}
              data-drop-outer=${b.outer ? '1' : nothing}
              title=${isDead(b) ? `Already docked ${b.zone}` : b.label}
              style=${styleMap({
                width: `${b.outer ? btnOut : btn}px`,
                height: `${b.outer ? btnOut : btn}px`,
                transform: `translate(${b.dx - (b.outer ? btnOut : btn) / 2}px, ${b.dy - (b.outer ? btnOut : btn) / 2}px)`,
              })}
            >
              <i></i>
            </div>
          `,
        )}
      </div>
    `;
  }

  /** Blue rectangle for the resolved target, plus the compass and the stack hint. */
  private dropIndicator() {
    const drag = this.drag;
    if (drag?.kind !== 'panel' || !drag.active || !this.container) {
      return nothing;
    }

    const base = this.container.getBoundingClientRect();
    const target = drag.target ?? { kind: 'float' as const };
    const rel = (b: Box) => ({
      left: `${b.left - base.left}px`,
      top: `${b.top - base.top}px`,
      width: `${b.width}px`,
      height: `${b.height}px`,
    });

    // Nothing would change: no preview at all, just the compass.
    if (target.kind === 'none') {
      return html`${this.compassTpl(target, base, drag.panelId)}`;
    }

    // No target: preview the window it would pop out into.
    if (target.kind === 'float' || !target.preview) {
      const ghost = drag.ghost?.getBoundingClientRect();
      const preview = ghost
        ? html`<div
            class="dock-drop is-float"
            style=${styleMap(
              rel({
                left: ghost.left,
                top: ghost.top,
                width: this.defaultWindowSize.width,
                height: this.defaultWindowSize.height,
              }),
            )}
          ></div>`
        : nothing;
      return html`${preview}${this.compassTpl(target, base, drag.panelId)}`;
    }

    return html`
      
      <div class="dock-drop" style=${styleMap(rel(target.preview))}></div>
      ${this.compassTpl(target, base, drag.panelId)}
    `;
  }

  // -------------------------------------------------------------- panel hosts

  /** The persistent element a panel renders into. Created once, reparented forever. */
  private hostFor(panelId: string): HTMLElement {
    const cached = this.hosts.get(panelId);
    if (cached) {
      return cached.el;
    }

    const def = this.defs.get(panelId);
    const el = document.createElement('div');
    el.className = 'dock-panel';
    el.dataset.panel = panelId;

    const entry: Host = { el };
    this.hosts.set(panelId, entry);

    if (def) {
      const dispose = def.render(el, this.contextFor(panelId));
      if (typeof dispose === 'function') {
        entry.dispose = dispose;
      }
    } else {
      el.textContent = `Unknown panel "${panelId}"`;
    }
    return el;
  }

  private contextFor(panelId: string): PanelContext {
    return {
      id: panelId,
      manager: this,
      setTitle: (title) => {
        if (this.titleOverrides.get(panelId) === title) {
          return;
        }
        this.titleOverrides.set(panelId, title);
        // titles show outside the dock too (a panels toggle bar reading
        // `title(id)`) — notify layout subscribers, not just the dock's render
        this.commit();
      },
      setMinSize: (min) => {
        const prev = this.runtimeMin.get(panelId);
        if (prev?.width === min.width && prev?.height === min.height) {
          return;
        }
        this.runtimeMin.set(panelId, min);
        this.requestRender();
      },
      close: () => this.closePanel(panelId),
      float: (rect) => void this.floatPanel(panelId, rect),
      isActive: () => {
        for (const tree of this.trees()) {
          const node = L.findTabsWithPanel(tree, panelId);
          if (node) {
            return node.activePanel === panelId;
          }
        }
        return false;
      },
      isFloating: () => this.isFloating(panelId),
    };
  }

  // ----------------------------------------------------------------- resizing

  /** True when a child never resizes during a divider drag: structural lock,
   *  collapsed, or a fixed-size child not adjacent to the dragged divider.
   *  (Size-LOCKED groups are not rigid — they yield as a last resort.) */
  private rigidInDrag(child: LayoutNode, adjacent: boolean): boolean {
    return !!child.locked || L.isCollapsedTree(child) || (child.fixedSize != null && !adjacent);
  }

  private startResize(e: PointerEvent, node: SplitNode, index: number) {
    const el = e.currentTarget as HTMLElement;
    const slots = [...(el.parentElement?.querySelectorAll<HTMLElement>(':scope > .dock-slot') ?? [])];
    if (slots.length !== node.children.length || !slots[index] || !slots[index + 1]) {
      return;
    }

    const axis = node.direction;
    const px = (n: HTMLElement) =>
      axis === 'row' ? n.getBoundingClientRect().width : n.getBoundingClientRect().height;
    // minOf already folds in any padlock floor (measureMin), so a locked
    // group — even one nested inside a sub-split — reads as un-shrinkable
    const minPx = (child: LayoutNode) => (axis === 'row' ? this.minOf(child).width : this.minOf(child).height);
    const sizeLocked = (child: LayoutNode) => child.type === 'tabs' && !!child.sizeLocked;
    this.drag = {
      kind: 'resize',
      splitId: node.id,
      index,
      axis,
      startPos: axis === 'row' ? e.clientX : e.clientY,
      startPx: node.children.map((_c, i) => px(slots[i])),
      minPx: node.children.map(minPx),
      rigid: node.children.map((c, i) => this.rigidInDrag(c, i === index || i === index + 1)),
      locked: node.children.map(sizeLocked),
      aFixed: node.children[index].fixedSize ?? null,
      bFixed: node.children[index + 1].fixedSize ?? null,
      aInner: null,
      bInner: null,
    };
    // capture same-axis nested splits touching the divider (cascadeInner)
    const innerOf = (child: LayoutNode): InnerCapture | null => {
      if (child.type !== 'split' || child.direction !== axis) {
        return null;
      }
      const host = document.querySelector(`[data-node="${child.id}"]`);
      const inSlots = [...(host?.querySelectorAll<HTMLElement>(':scope > .dock-slot') ?? [])];
      if (inSlots.length !== child.children.length) {
        return null;
      }
      return {
        splitId: child.id,
        startPx: child.children.map((_ch, j) => px(inSlots[j])),
        minPx: child.children.map(minPx),
        rigid: child.children.map((ch) => this.rigidInDrag(ch, false)),
        locked: child.children.map(sizeLocked),
      };
    };
    this.drag.aInner = innerOf(node.children[index]);
    this.drag.bInner = innerOf(node.children[index + 1]);

    el.setPointerCapture(e.pointerId);
    document.body.classList.add(axis === 'row' ? 'dock-resizing-x' : 'dock-resizing-y');
    this.bindDragListeners();
    e.preventDefault();
  }

  /** Distribute `amount` of shrink across `order`, strictly nearest-the-
   *  divider first, each child down to its minimum. A size-locked group needs
   *  no special case: its floor IS its current size, so it has no room and
   *  the cascade flows straight through it. Returns px taken per index. */
  private distributeShrink(
    order: number[],
    amount: number,
    startPx: number[],
    minPx: number[],
    rigid: boolean[],
  ): Map<number, number> {
    const take = new Map<number, number>();
    let rem = amount;
    for (const j of order) {
      if (rem <= 0) {
        break;
      }
      if (rigid[j]) {
        continue;
      }
      const t = Math.min(rem, Math.max(0, startPx[j] - minPx[j]));
      if (t > 0) {
        take.set(j, t);
        rem -= t;
      }
    }
    return take;
  }

  private moveResize(e: PointerEvent, drag: ResizeDrag) {
    const node = this.findNodeAnywhere(drag.splitId);
    if (node?.type !== 'split') {
      return;
    }

    const pos = drag.axis === 'row' ? e.clientX : e.clientY;
    const raw = pos - drag.startPos;
    const { startPx, minPx, rigid, locked } = drag;
    const n = node.children.length;
    const idx = drag.index;

    // cascade: the side the divider moves toward shrinks nearest-first; only
    // the nearest resizable child on the other side grows. Hard stop when the
    // shrink side has no capacity left.
    const shrinkOrder: number[] = [];
    const growOrder: number[] = [];
    if (raw >= 0) {
      for (let j = idx + 1; j < n; j++) {
        shrinkOrder.push(j);
      }
      for (let j = idx; j >= 0; j--) {
        growOrder.push(j);
      }
    } else {
      for (let j = idx; j >= 0; j--) {
        shrinkOrder.push(j);
      }
      for (let j = idx + 1; j < n; j++) {
        growOrder.push(j);
      }
    }
    // grow: nearest UNLOCKED panel — a locked block slides instead of
    // inflating; it only grows when nothing unlocked is left on that side
    const growAt = growOrder.find((j) => !rigid[j] && !locked[j]) ?? growOrder.find((j) => !rigid[j]);
    const capacity = shrinkOrder.reduce((sum, j) => (rigid[j] ? sum : sum + Math.max(0, startPx[j] - minPx[j])), 0);
    const eff = growAt == null ? 0 : Math.min(Math.abs(raw), capacity);

    const newPx = startPx.slice();
    for (const [j, t] of this.distributeShrink(shrinkOrder, eff, startPx, minPx, rigid)) {
      newPx[j] -= t;
    }
    if (growAt != null) {
      newPx[growAt] += eff;
    }

    // write pixel weights for flex children on ONE scale (flex only cares
    // about ratios) and fixedSize for the adjacent fixed child(ren). Clamp to
    // min so the stored numbers can never disagree with the CSS min floor.
    node.children.forEach((child, j) => {
      const v = Math.max(newPx[j], minPx[j]);
      if (child.fixedSize != null) {
        if (j === idx && drag.aFixed != null) {
          child.fixedSize = v;
        } else if (j === idx + 1 && drag.bFixed != null) {
          child.fixedSize = v;
        }
        return; // fixed slots ignore sizes[]
      }
      node.sizes[j] = v;
    });

    // adjacent same-axis nested splits: the child TOUCHING the divider
    // absorbs first, then the cascade walks inward with the same priorities
    const dA = newPx[idx] - startPx[idx];
    const dB = newPx[idx + 1] - startPx[idx + 1];
    if (drag.aInner && dA !== 0) {
      this.cascadeInner(drag.aInner, dA, 'last');
    }
    if (drag.bInner && dB !== 0) {
      this.cascadeInner(drag.bInner, dB, 'first');
    }

    this.requestRender();
  }

  /** Apply a size delta entering a captured nested split from its divider-
   *  touching end: growth goes to the nearest resizable child (unlocked
   *  preferred); shrink cascades inward with per-child min clamps. */
  private cascadeInner(inner: InnerCapture, delta: number, side: 'last' | 'first') {
    const split = this.findNodeAnywhere(inner.splitId);
    if (split?.type !== 'split') {
      return;
    }
    const m = split.children.length;
    const order: number[] = [];
    if (side === 'last') {
      for (let j = m - 1; j >= 0; j--) {
        order.push(j);
      }
    } else {
      for (let j = 0; j < m; j++) {
        order.push(j);
      }
    }

    const newPx = inner.startPx.slice();
    if (delta > 0) {
      const at = order.find((j) => !inner.rigid[j] && !inner.locked[j]) ?? order.find((j) => !inner.rigid[j]);
      if (at != null) {
        newPx[at] += delta;
      }
    } else {
      for (const [j, t] of this.distributeShrink(order, -delta, inner.startPx, inner.minPx, inner.rigid)) {
        newPx[j] -= t;
      }
    }
    split.children.forEach((child, j) => {
      if (child.fixedSize == null) {
        split.sizes[j] = Math.max(newPx[j], inner.minPx[j]);
      }
    });
  }

  /** Escape / pointercancel: put every captured size back exactly. */
  private restoreResize(drag: ResizeDrag) {
    const node = this.findNodeAnywhere(drag.splitId);
    if (node?.type !== 'split') {
      return;
    }
    node.children.forEach((child, j) => {
      if (child.fixedSize != null) {
        if (j === drag.index && drag.aFixed != null) {
          child.fixedSize = drag.aFixed;
        } else if (j === drag.index + 1 && drag.bFixed != null) {
          child.fixedSize = drag.bFixed;
        }
        return;
      }
      node.sizes[j] = drag.startPx[j];
    });
    for (const inner of [drag.aInner, drag.bInner]) {
      if (!inner) {
        continue;
      }
      const split = this.findNodeAnywhere(inner.splitId);
      if (split?.type !== 'split') {
        continue;
      }
      split.children.forEach((ch, j) => {
        if (ch.fixedSize == null) {
          split.sizes[j] = inner.startPx[j];
        }
      });
    }
  }

  // ------------------------------------------------------ floating window drag

  private startWindowDrag(e: PointerEvent, win: FloatingWindow, mode: 'move' | 'resize', edges?: WindowDrag['edges']) {
    if (e.button !== 0 && e.pointerType === 'mouse') {
      return;
    }
    e.stopPropagation();
    e.preventDefault();

    win.z = this.zTop++;
    this.drag = {
      kind: 'window',
      windowId: win.id,
      mode,
      edges: edges ?? { n: false, s: false, e: false, w: false },
      startX: e.clientX,
      startY: e.clientY,
      start: { x: win.x, y: win.y, width: win.width, height: win.height },
      min: this.minOf(win.node),
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.classList.add('dock-dragging');
    this.bindDragListeners();
    this.requestRender();
  }

  private moveWindowDrag(e: PointerEvent, drag: WindowDrag) {
    const i = this.windows.findIndex((w) => w.id === drag.windowId);
    if (i < 0) {
      return;
    }
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const s = drag.start;
    const minW = drag.min.width;
    const minH = drag.min.height + this.windowBarHeight;

    let next: FloatingWindow = { ...this.windows[i] };
    if (drag.mode === 'move') {
      next.x = s.x + dx;
      next.y = s.y + dy;
      next = this.clampWindow(next);
    } else {
      if (drag.edges.e) {
        next.width = Math.max(minW, s.width + dx);
      }
      if (drag.edges.s) {
        next.height = Math.max(minH, s.height + dy);
      }
      if (drag.edges.w) {
        next.width = Math.max(minW, s.width - dx);
        next.x = s.x + (s.width - next.width);
      }
      if (drag.edges.n) {
        next.height = Math.max(minH, s.height - dy);
        next.y = s.y + (s.height - next.height);
      }
    }

    this.windows = this.windows.map((w, j) => (j === i ? next : w));
    this.requestRender();
  }

  // ------------------------------------------------------------ panel dragging

  /** Start dragging a panel from OUTSIDE the dock — e.g. a Panels-ribbon
   *  button — reusing the exact tab-drag/drop flow. If the panel is closed it
   *  is placed wherever dropped; if open it moves. Pair with consumeDragClick()
   *  so the button's click doesn't also toggle after a real drag. */
  dragPanelFrom(e: PointerEvent, panelId: string) {
    this.startPanelDrag(e, panelId);
  }

  /** True (once) if the last panel drag actually moved — the caller uses this
   *  to skip the click that a browser fires after a drag. */
  consumeDragClick(): boolean {
    const v = this.panelDragActivated;
    this.panelDragActivated = false;
    return v;
  }

  private panelDragActivated = false;

  private startPanelDrag(e: PointerEvent, panelId: string) {
    if (e.button !== 0 && e.pointerType === 'mouse') {
      return;
    }
    this.panelDragActivated = false;
    this.drag = {
      kind: 'panel',
      panelId,
      startX: e.clientX,
      startY: e.clientY,
      // Fingers wobble; a mouse doesn't.
      threshold: e.pointerType === 'touch' ? 10 : 5,
      active: false,
    };
    // Implicit pointer capture on touch keeps events flowing to the tab, and the
    // tab has touch-action: none, so the page never scrolls under the drag.
    this.bindDragListeners();
  }

  private movePanelDrag(e: PointerEvent, drag: PanelDrag) {
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < drag.threshold) {
        return;
      }
      drag.active = true;
      this.panelDragActivated = true;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'dock-ghost';
      drag.ghost.textContent = this.title(drag.panelId);
      document.body.appendChild(drag.ghost);
      document.body.classList.add('dock-dragging');
    }

    // Offset the ghost so a finger never covers the drop target it's aiming at.
    const lift = e.pointerType === 'touch' ? -34 : 12;
    if (drag.ghost) {
      drag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + lift}px)`;
    }

    drag.target = this.hitTest(e.clientX, e.clientY, drag.panelId);
    this.requestRender();
  }

  private hitTest(x: number, y: number, panelId: string): DropTarget {
    const stack = document.elementsFromPoint(x, y) as HTMLElement[];
    const base = this.container?.getBoundingClientRect();
    if (!base) {
      return { kind: 'float' };
    }

    // Whatever else happens, remember which panel we're over — it drives the hint.
    const hovered = stack.find((el) => el.dataset?.dockTarget === '1' && this.container?.contains(el));
    const hoverNodeId = hovered?.dataset.node;
    const hoverRect = hovered?.getBoundingClientRect();
    const hover = { hoverNodeId, hoverRect };

    // Releasing on nothing means "pop out" — unless the panel is already its own
    // window, in which case it means nothing at all.
    const loose = (): DropTarget =>
      this.isSoleFloating(panelId) || !this.canFloat(panelId)
        ? { kind: 'none', ...hover }
        : { kind: 'float', ...hover };

    // 1. Compass button. Anchored to a panel: center = tab there, directions
    //    split that panel. No anchor: dock against the whole area.
    const btn = stack.find((el) => el.dataset?.dropZone);
    const drag = this.drag?.kind === 'panel' ? this.drag : null;
    if (!btn && drag) {
      // re-anchor only while NOT aiming at a button, so the compass stays put
      drag.anchor = hovered && hoverNodeId && hoverRect ? { nodeId: hoverNodeId, rect: hoverRect } : undefined;
    }
    if (btn) {
      const zone = btn.dataset.dropZone as Exclude<DropZone, 'float'>;
      const anchor = drag?.anchor;
      // outer-ring buttons: dock beside the anchored panel's top-level
      // column/row (in between), or at the dock edge as the fallback
      if (anchor && btn.dataset.dropOuter === '1' && zone !== 'center') {
        const spot = this.outerSpot(anchor.nodeId, zone as L.SplitZone, panelId);
        return spot
          ? { kind: 'dock', zone, inner: spot.inner, outer: true, nodeId: spot.nodeId, preview: spot.preview, ...hover }
          : { kind: 'none', ...hover };
      }
      if (anchor) {
        if (zone === 'center') {
          const refused = !this.canDockInto(panelId, anchor.nodeId) || this.tabIsNoop(panelId, anchor.nodeId);
          return refused
            ? { kind: 'none', ...hover }
            : { kind: 'dock', zone, nodeId: anchor.nodeId, preview: anchor.rect, ...hover };
        }
        return {
          kind: 'dock',
          zone,
          inner: true,
          nodeId: anchor.nodeId,
          preview: this.edgeBox(anchor.rect, zone as Exclude<DropZone, 'float' | 'center'>),
          ...hover,
        };
      }
      if (zone === 'center') {
        const central = this.centralLeaf();
        if (central) {
          return { kind: 'dock', zone, nodeId: central.id, preview: central.rect, ...hover };
        }
        return loose();
      }
      const region = this.regionRect();
      if (!region) {
        return loose();
      }
      return { kind: 'dock', zone, nodeId: region.id, preview: this.edgeBox(region.rect, zone), ...hover };
    }

    if (!hovered || !hoverRect || !hoverNodeId) {
      return loose();
    }

    // 2. Tab strip: insert (or reorder) at that position.
    if (stack.some((el) => el.classList?.contains('dock-tabstrip'))) {
      const tab = stack.find((el) => el.dataset?.tab != null);
      let tabIndex: number | undefined;
      if (tab) {
        const tabRect = tab.getBoundingClientRect();
        tabIndex = Number(tab.dataset.tabIndex) + (x > tabRect.left + tabRect.width / 2 ? 1 : 0);
      }
      const refused = !this.canDockInto(panelId, hoverNodeId) || this.tabIsNoop(panelId, hoverNodeId, tabIndex);
      return refused
        ? { kind: 'none', ...hover }
        : { kind: 'tab', nodeId: hoverNodeId, tabIndex, preview: hoverRect, ...hover };
    }

    const node = this.findNodeAnywhere(hoverNodeId);
    if (node?.type === 'tabs' && node.panels.length === 0 && this.canDockInto(panelId, hoverNodeId)) {
      return { kind: 'tab', nodeId: hoverNodeId, preview: hoverRect, ...hover };
    }

    // 3. Over a panel but aiming at nothing in particular → it pops out (dialog).
    return loose();
  }

  private dropPanel(drag: PanelDrag, e: PointerEvent) {
    const target = drag.target ?? { kind: 'float' as const };
    // debug: every refused drop says why (temporary diagnostic)
    const refuse = (why: string) => console.warn(`dock drop no-op: ${why}`, target);
    if (target.kind === 'none') {
      refuse('target resolved to none');
      return;
    }

    if (target.kind === 'float' || !target.nodeId) {
      const def = this.defs.get(drag.panelId);
      if (def?.floatable === false) {
        refuse('panel not floatable');
        return;
      }
      const sole = this.windows.find(
        (w) => L.allPanels(w.node).length === 1 && L.allPanels(w.node)[0] === drag.panelId,
      );
      if (sole) {
        refuse('already its own window');
        return; // already its own window — drag the window, not the tab
      }
      const base = this.container?.getBoundingClientRect();
      this.floatPanel(drag.panelId, {
        x: (base ? e.clientX - base.left : e.clientX) - 40,
        y: (base ? e.clientY - base.top : e.clientY) - 12,
      });
      return;
    }

    const nodeId = target.nodeId;
    const source = this.trees()
      .map((t) => L.findTabsWithPanel(t, drag.panelId))
      .find(Boolean);

    // Re-tabbing a panel into the strip it already lives in, at the same spot.
    const tabbing = target.kind === 'tab' || (target.kind === 'dock' && target.zone === 'center');
    if (source?.id === nodeId && tabbing && target.tabIndex == null) {
      refuse('re-tab into its own strip');
      return;
    }

    // detaching the panel can prune/unwrap nodes (e.g. dragging the only
    // bottom panel unwraps the viewport column split) — remember the target's
    // descendants so a vanished target falls back to its surviving subtree
    const targetNode = this.findNodeAnywhere(nodeId);
    const fallbackIds: string[] = [];
    if (targetNode) {
      L.walk(targetNode, (n) => {
        if (n.id !== nodeId) {
          fallbackIds.push(n.id);
        }
      });
    }

    const snapshot = this.saveLayout();
    this.detach(drag.panelId);

    let dockId = nodeId;
    if (!this.findNodeAnywhere(dockId)) {
      dockId = fallbackIds.find((id) => this.findNodeAnywhere(id)) ?? '';
    }
    if (!dockId) {
      refuse(`target node ${nodeId} vanished after detach (no surviving descendant)`);
      this.root = snapshot.root; // the target collapsed along with the source
      this.windows = snapshot.windows;
      return;
    }

    if (tabbing) {
      this.insertInto(dockId, drag.panelId, target.tabIndex);
    } else if (target.kind === 'dock' && target.zone && target.zone !== 'center') {
      if (target.inner) {
        this.editTreeWith(dockId, (tree) => L.splitWithPanel(tree, dockId, drag.panelId, target.zone as L.SplitZone));
      } else {
        // edge-dock within whichever tree owns the target — a floating
        // window's region edge must dock inside that window, not the dock
        this.editTreeWith(dockId, (tree) => L.dockAtEdge(tree, dockId, drag.panelId, target.zone as L.SplitZone));
      }
    }
    this.commit();
  }

  // ------------------------------------------------------------ shared pointer

  private onMove = (e: PointerEvent) => {
    const drag = this.drag;
    if (!drag) {
      return;
    }
    if (drag.kind === 'resize') {
      this.moveResize(e, drag);
    } else if (drag.kind === 'window') {
      this.moveWindowDrag(e, drag);
    } else {
      this.movePanelDrag(e, drag);
    }
  };

  private onUp = (e: PointerEvent) => {
    const drag = this.drag;
    this.unbindDragListeners();
    this.drag = null;
    document.body.classList.remove('dock-dragging', 'dock-resizing-x', 'dock-resizing-y');
    if (!drag) {
      return;
    }

    if (drag.kind === 'panel') {
      drag.ghost?.remove();
      if (drag.active && !drag.cancelled) {
        this.dropPanel(drag, e);
      }
      // always re-render: dropPanel's early-return paths (invalid target,
      // re-tab onto itself, …) would otherwise leave the drop overlay stuck
      this.requestRender();
    } else {
      this.commit();
    }
  };

  private onCancel = () => {
    const drag = this.drag;
    if (drag?.kind === 'panel') {
      drag.cancelled = true;
    }
    if (drag?.kind === 'resize') {
      this.restoreResize(drag); // aborted gesture: snap back to start sizes
    }
    this.onUp(new PointerEvent('pointerup'));
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.onCancel();
    }
  };

  private bindDragListeners() {
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('keydown', this.onKey);
  }

  private unbindDragListeners() {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('keydown', this.onKey);
  }
}
