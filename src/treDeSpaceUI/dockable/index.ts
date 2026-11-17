import './dockable.css';

export { DockManager } from './DockManager';
export {
  allPanels,
  cloneLayout,
  findNode,
  findTabsWithPanel,
  isEmpty,
  measureMin,
  normalizeLayout,
  split,
  tabs,
} from './layout';
// The React bindings (DockView, definePanel, the hooks) are re-exported here;
// DockManager itself is framework-free.
export {
  DockView,
  definePanel,
  PanelBody,
  reactPanel,
  useDockLayout,
  useDockManager,
  useIsFloating,
  useMinSize,
  usePanelContext,
  usePanelTitle,
} from './react';
export type {
  DockManagerOptions,
  DockState,
  DropZone,
  FloatingWindow,
  LayoutNode,
  PanelContext,
  PanelDefinition,
  PanelRenderer,
  Rect,
  Size,
  SplitNode,
  TabsNode,
} from './types';
