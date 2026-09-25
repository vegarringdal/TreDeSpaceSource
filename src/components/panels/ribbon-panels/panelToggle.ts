// Global hotkeys reach the dock manager's panel toggle through this slot (the
// panelRegistry opener pattern): useAppStartup registers it once with the
// live manager, the Panels ribbon and the bindings only call it.

/** A built-in panel with a show / hide hotkey — ids and titles as declared in
 *  appPanels.ts (the title is only the hotkey's label; the ribbon reads the
 *  live one). The ALT codes are ASSIGNED in the 6xx Home / panels block and
 *  are never renumbered: inserting a panel must not shift the others. Five
 *  everyday panels answer to a CTRL chord instead. */
export interface PanelToggle {
  id: string;
  title: string;
  /** Default combo in the hotkey display grammar. */
  keys: string;
}

export const PANEL_TOGGLES: readonly PanelToggle[] = [
  { id: 'hierarchy', title: 'Hierarchy', keys: 'ALT + 670' },
  { id: 'quickColors', title: 'Color Panel', keys: 'ALT + 671' },
  { id: 'console', title: 'Console', keys: 'ALT + 672' },
  { id: 'settings', title: 'Settings', keys: 'CTRL&S' },
  { id: 'measurements', title: 'Measurement List', keys: 'ALT + 674' },
  { id: 'clipShapes', title: 'Clip Shape List', keys: 'ALT + 675' },
  { id: 'modelAssets', title: 'Model Assets', keys: 'ALT + 676' },
  { id: 'sqlAssets', title: 'SQL Assets', keys: 'ALT + 677' },
  { id: 'sqlEditor', title: 'SQL Editor', keys: 'ALT + 678' },
  { id: 'sqlReports', title: 'Sql Report', keys: 'ALT + 679' },
  { id: 'sqlTable', title: 'SQL Table', keys: 'ALT + 680' },
  { id: 'sqlDetail', title: 'SQL Detail', keys: 'ALT + 681' },
  { id: 'multiColor', title: 'Set Color', keys: 'CTRL&C' },
  { id: 'labels', title: 'Label', keys: 'CTRL&L' },
  { id: 'importManager', title: 'Import Manager', keys: 'CTRL&I' },
  { id: 'export', title: 'Export', keys: 'CTRL&E' },
  { id: 'viewpoints', title: 'Viewpoint Editor', keys: 'ALT + 686' },
  { id: 'viewpointViewer', title: 'Viewpoint Viewer', keys: 'ALT + 687' },
  { id: 'labelsViewpoint', title: 'Label (viewpoint)', keys: 'ALT + 688' },
  { id: 'measurementsViewpoint', title: 'Measurement (viewpoint)', keys: 'ALT + 689' },
  { id: 'multiColorViewpoint', title: 'Set Color (viewpoint)', keys: 'ALT + 690' },
];

const TOGGLE_IDS = new Set(PANEL_TOGGLES.map((p) => p.id));

/** The hotkey id that shows / hides panel `id` (the Panels ribbon puts it on
 *  the toggle button so the tooltip carries the combo). */
export function panelToggleHotkeyId(id: string): string {
  return `panel.toggle.${id}`;
}

/** True when panel `id` is a built-in with a toggle hotkey. */
export function hasPanelToggle(id: string): boolean {
  return TOGGLE_IDS.has(id);
}

let toggler: ((id: string) => void) | null = null;

export function registerPanelToggler(fn: ((id: string) => void) | null): void {
  toggler = fn;
}

/** Show / hide a dock panel by id — a no-op until the manager is registered. */
export function togglePanelById(id: string): void {
  toggler?.(id);
}
