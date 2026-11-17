// The ribbon strip's tabs: their titles and the tooltip each tab carries. Pure
// data — the panel table (appPanels.ts) builds the ribbon definitions from it.

type RibbonTab = Readonly<{
  /** Panel id of the ribbon (appPanels.ts). */
  id: string;
  title: string;
  /** What the ribbon holds, as its tab tooltip says it. */
  holds: string;
}>;

/** Every ribbon tab. */
export const RIBBON_TABS: readonly RibbonTab[] = [
  { id: 'ribbonHome', title: 'Home', holds: 'assets, canvas, draw mode and quick clear' },
  {
    id: 'ribbonClippingPlane',
    title: 'Clipping Plane',
    holds: 'cut the model with X / Y / Z planes — on/off, position, rotation, flip',
  },
  { id: 'ribbonClippingBox', title: 'Clipping Box', holds: 'cut the model with a box — size, move, resize, gizmo' },
  {
    id: 'ribbonSelectionColor',
    title: 'Selection Color',
    holds: 'color, fade and hide the selected items, with reset and history',
  },
  { id: 'ribbonSelectionTransform', title: 'Transform', holds: 'move, rotate and scale the selected items' },
  { id: 'ribbonMeasurements', title: 'Measurement', holds: 'the measure tool, snapping, lock and options' },
  { id: 'ribbonAnimation', title: 'Animation', holds: 'the animation document, editing, view and export' },
  { id: 'ribbonPanels', title: 'Panel', holds: 'show or hide the internal and external panels' },
  {
    id: 'ribbonLayout',
    title: 'App Layout',
    holds: 'the default (F1–F12) and your own (CTRL+F1–F12) app layouts, and overriding the selected one',
  },
  { id: 'ribbonExternal', title: 'External', holds: 'one button per configured external app' },
  {
    id: 'ribbonPad',
    title: 'Pad',
    holds: 'big touch controls — view helpers, tree navigation, camera mode and the move joystick',
  },
];

/**
 * A ribbon tab's tooltip. Clicking the tab only switches the ribbon; a tab
 * whose ribbon belongs to a default app layout also shows that layout's F-key
 * under the text (the tab's `shortcut`), and the F-key swaps the panels too —
 * `hasLayoutKey` adds the line that says so.
 */
export function ribbonTabTooltip(tab: RibbonTab, hasLayoutKey: boolean): string {
  const text = `${tab.title} ribbon: ${tab.holds}.`;
  if (!hasLayoutKey) {
    return text;
  }

  return `${text}\nClicking the tab only switches the ribbon — the shortcut also switches to this app layout's configured panels.`;
}
