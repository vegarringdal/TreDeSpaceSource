// The app's dock workspace, shared by App.tsx (first-load / Reset panel layout)
// and the default Layout slots (Settings → Layouts, Layout ribbon F1–F12). One
// builder so every preset stays in sync with the real panel/ribbon ids.
import { type DockState, type LayoutNode, split, tabs } from '@treDeSpaceUI/dockable';

/** Ribbon tabs in the fixed top strip (order = tab order). */
const RIBBONS = [
  'ribbonHome',
  'ribbonClippingPlane',
  'ribbonClippingBox',
  'ribbonSelectionColor',
  'ribbonSelectionTransform',
  'ribbonMeasurements',
  'ribbonExternal',
  'ribbonPanels',
  'ribbonPad',
  'ribbonLayout',
];

const ribbonStrip = (activeRibbon: string): LayoutNode =>
  tabs(RIBBONS, { id: 'top', fixedSize: 124, locked: true, collapsible: true, activePanel: activeRibbon });

/**
 * A full workspace snapshot: the ribbon strip over `hierarchy | viewport+console`
 * plus an optional right-hand panel. `rightPanel` = null closes the right region
 * (two columns); `collapseConsole` minimizes the bottom console to its tab strip.
 * Used both as the base layout and for the named Layout slots.
 */
export function workspace(activeRibbon: string, rightPanel: string | null, collapseConsole = false): DockState {
  const consoleTabs = tabs(['console'], { id: 'bottom', fixedSize: 170, collapsed: collapseConsole || undefined });
  const center = split('column', [tabs(['viewport']), consoleTabs]);
  const row = rightPanel
    ? split('row', [tabs(['hierarchy'], { id: 'left' }), center, tabs([rightPanel], { id: 'right' })], [20, 58, 22])
    : split('row', [tabs(['hierarchy'], { id: 'left' }), center], [22, 78]);
  return { root: split('column', [ribbonStrip(activeRibbon), row]), windows: [] };
}

/** The "Viewpoint" slot (F10): the presentation/authoring workspace —
 *  Hierarchy | Viewpoint Viewer | viewport | (Viewpoints over Measurements) |
 *  (Set Color over Labels), every viewpoint editor visible at once. */
export function viewpointWorkspace(activeRibbon: string): DockState {
  const hierarchy = tabs(['hierarchy'], { id: 'left' });
  const viewer = tabs(['viewpointViewer']);
  const listCol = split('column', [tabs(['viewpoints']), tabs(['measurementsViewpoint'])]);
  const editCol = split('column', [tabs(['multiColorViewpoint'], { id: 'right' }), tabs(['labelsViewpoint'])]);
  const row = split('row', [hierarchy, viewer, tabs(['viewport']), listCol, editCol], [12, 12, 40, 18, 18]);
  return { root: split('column', [ribbonStrip(activeRibbon), row]), windows: [] };
}

/** The "SQL Editor" slot (F11): Hierarchy | SQL Reports | SQL Editor |
 *  (viewport over SQL Table over console) | SQL Detail. */
export function sqlWorkspace(activeRibbon: string): DockState {
  const center = split(
    'column',
    [tabs(['viewport']), tabs(['sqlTable']), tabs(['console'], { id: 'bottom', fixedSize: 150 })],
    [68, 32, 1],
  );
  const row = split(
    'row',
    [
      tabs(['hierarchy'], { id: 'left' }),
      tabs(['sqlReports']),
      tabs(['sqlEditor']),
      center,
      tabs(['sqlDetail'], { id: 'right' }),
    ],
    [12, 11, 15, 46, 16],
  );
  return { root: split('column', [ribbonStrip(activeRibbon), row]), windows: [] };
}

/** The "Assets" slot (F12): the asset-management workspace — Hierarchy |
 *  (Model Assets over SQL Assets) | (viewport over console) | Import Manager |
 *  Export. */
export function assetsWorkspace(activeRibbon: string): DockState {
  const center = split('column', [tabs(['viewport']), tabs(['console'], { id: 'bottom', fixedSize: 150 })]);
  const assetsCol = split('column', [tabs(['modelAssets']), tabs(['sqlAssets'])]);
  const row = split(
    'row',
    [
      tabs(['hierarchy'], { id: 'left' }),
      assetsCol,
      center,
      tabs(['importManager'], { id: 'right' }),
      tabs(['export']),
    ],
    [14, 18, 38, 15, 15],
  );
  return { root: split('column', [ribbonStrip(activeRibbon), row]), windows: [] };
}

/** A bare workspace: the ribbon strip over just the viewport — no side panels
 *  or console. Used by the blank-scene fallback. */
export function viewportOnly(activeRibbon: string): DockState {
  return { root: split('column', [ribbonStrip(activeRibbon), tabs(['viewport'])]), windows: [] };
}

/** First-load layout + what "Reset panel layout" restores (Home ribbon + Settings). */
export const defaultLayout: LayoutNode = workspace('ribbonHome', 'settings').root;
