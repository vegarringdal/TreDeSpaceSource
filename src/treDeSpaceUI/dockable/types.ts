import type { DockManager } from './DockManager';

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a dragged panel lands. 'float' = released over nothing dockable. */
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom' | 'float';

interface BaseNode {
  id: string;
  /**
   * A locked node is frozen: its panels cannot be dragged out or floated,
   * nothing can be dropped into it, its tabs have no close buttons, and the
   * splitters touching it are inert. Use it for toolbars, status bars, fixed
   * sidebars. Locking is inherited by everything inside.
   */
  locked?: boolean;
  /** Pixel size along the parent split's axis. Beats the content minimum. */
  fixedSize?: number;
}

/** A row/column of child nodes with draggable splitters between them. */
export interface SplitNode extends BaseNode {
  type: 'split';
  direction: 'row' | 'column';
  children: LayoutNode[];
  /** Weights, parallel to `children`. Any positive scale works; only ratios matter. */
  sizes: number[];
}

/** A leaf: one or more panels sharing a tab strip. */
export interface TabsNode extends BaseNode {
  type: 'tabs';
  panels: string[];
  activePanel?: string;
  /** Hide the tab strip. Only sensible for a single-panel node (e.g. a toolbar). */
  hideTabs?: boolean;
  /**
   * Collapsed to its tab strip alone: a header in a column, a narrow rail in a
   * row. Its siblings take the space. Panel content is detached, not destroyed —
   * React state and WebGL contexts survive a collapse.
   */
  collapsed?: boolean;
  /** Default true. False hides the chevron and refuses `toggleCollapse`. */
  collapsible?: boolean;
  /**
   * The tab-strip padlock. Locking captures the group's CURRENT size as its
   * minimum — nothing more: it can still grow, but never shrinks below the
   * size it was locked at, so divider drags cascade straight past it to the
   * next sibling. Container resizes still scale the group proportionally,
   * and chevron collapse is unaffected.
   */
  sizeLocked?: boolean;
  /**
   * The group's pixel size captured by the padlock at lock time — its
   * minimum (both axes) while `sizeLocked` is on. Folded into measureMin, so
   * it holds through any nesting and through container resizes. Managed by
   * the manager; cleared on unlock.
   */
  lockedSize?: Size;
}

export type LayoutNode = SplitNode | TabsNode;

/** A panel (or a whole sub-layout) lifted out of the dock into a dialog. */
export interface FloatingWindow extends Rect {
  id: string;
  node: LayoutNode;
  /** Stacking order. The manager bumps this on interaction. */
  z: number;
  /** Collapsed to just the title bar. */
  minimized?: boolean;
}

/** Everything you need to restore a workspace. Plain JSON. */
export interface DockState {
  root: LayoutNode;
  windows: FloatingWindow[];
}

export interface PanelContext {
  readonly id: string;
  readonly manager: DockManager;
  setTitle(title: string): void;
  /** Content declares how small it is willing to get. Propagates up the tree. */
  setMinSize(min: Partial<Size>): void;
  close(): void;
  /** Lift this panel out into a floating dialog. */
  float(rect?: Partial<Rect>): void;
  isActive(): boolean;
  isFloating(): boolean;
}

/**
 * Mount panel content into `host`. Return a disposer, called when the panel is
 * closed. Pure DOM by default — see `reactPanel()` for React content.
 */
export type PanelRenderer = (host: HTMLElement, ctx: PanelContext) => undefined | (() => void);

export interface PanelDefinition {
  id: string;
  title: string;
  /** Minimum content width in px. Content may raise this at runtime. */
  minWidth?: number;
  /** Minimum content height in px (excludes the tab strip). */
  minHeight?: number;
  /** Default true. Locked nodes never show close buttons regardless. */
  closable?: boolean;
  /** Default true. False keeps the panel docked. */
  floatable?: boolean;
  /**
   * Pin the panel to one or more nodes, by id. It can then only ever be dropped
   * into those nodes — no floating, no splitting, no docking elsewhere — which
   * leaves reordering its own tab strip as the only move. Give the node a stable
   * id yourself: `tabs(['a', 'b'], { id: 'top' })`.
   */
  dockableIn?: string | string[];
  /** Soft default node — where the panel reopens when its last location is
   *  unknown. Unlike `dockableIn` this does NOT pin the panel; it can still be
   *  dragged anywhere. Falls through to the first open node if the node is gone. */
  home?: string;
  /** Minimum width of the tab button, px. Use it to align a strip of tabs. */
  tabMinWidth?: number;
  /** Called when the panel is CLOSED — the tab ×, `closePanel`, `togglePanel`.
   *  NOT called when a layout swap (loadLayout / solo / kiosk) unmounts the
   *  content, so a runtime panel can clean itself up on a real close without
   *  disappearing every time the layout changes. */
  onClose?: (panelId: string) => void;
  render: PanelRenderer;
}

export interface DockManagerOptions {
  panels: PanelDefinition[];
  layout: LayoutNode;
  windows?: FloatingWindow[];
  /** Tab strip height in px. Default 22, on every pointer type. */
  headerHeight?: number;
  /** Minimum tab width for every tab, px. Panels can raise it individually. */
  tabMinWidth?: number;
  /** Splitter thickness in px. Default 6. The hit area widens on coarse pointers. */
  splitterSize?: number;
  /** Floating window title bar height in px. Default 26. */
  windowBarHeight?: number;
  /** Size of a window created by dragging a tab out. Default 340×260. */
  defaultWindowSize?: Size;
}
