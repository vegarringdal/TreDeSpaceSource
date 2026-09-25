import {
  IconBinaryTree,
  IconCamera,
  IconCube,
  IconDatabase,
  IconFileExport,
  IconLayoutBoard,
  IconLayoutGrid,
  IconListDetails,
  IconPalette,
  IconPresentation,
  type IconProps,
  IconReportAnalytics,
  IconSettings,
  IconSql,
  IconTable,
  IconTerminal2,
} from '@tabler/icons-react';
import { type PanelDefinition, usePanelContext } from '@treDeSpaceUI/dockable';
import { Ribbon, RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { type ForwardRefExoticComponent, type RefAttributes, useSyncExternalStore } from 'react';
import { isExternalPanelId } from '../ribbon-external/externalPanels';
import { hasPanelToggle, panelToggleHotkeyId } from './panelToggle';

const isRibbon = (dockableIn?: string | string[]) =>
  dockableIn === 'top' || (Array.isArray(dockableIn) && dockableIn.includes('top'));

type TablerIcon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

/** A fitting icon per panel id (falls back to a generic panel icon). */
const PANEL_ICON: Record<string, TablerIcon> = {
  hierarchy: IconBinaryTree,
  quickColors: IconPalette,
  widgets: IconLayoutGrid,
  console: IconTerminal2,
  settings: IconSettings,
  viewport: IconCube,
  viewpoints: IconCamera,
  viewpointViewer: IconPresentation,
  export: IconFileExport,
  sqlAssets: IconDatabase,
  sqlEditor: IconSql,
  sqlReports: IconReportAnalytics,
  sqlTable: IconTable,
  sqlDetail: IconListDetails,
};

/** The Panels ribbon: one toggle per panel (selected when visible — stays in
 *  sync however a panel is opened/closed), built-in panels in one section and
 *  external-app panels in their own. Closing then toggling a panel back
 *  returns it where it was; built-ins also toggle from their hotkey. */
export function RibbonPanels() {
  const { manager } = usePanelContext();
  // re-render on any layout change (open/close/move/float)
  useSyncExternalStore(
    (cb) => manager.subscribe(cb),
    () => manager.version,
  );

  // The viewport is the app's canvas — it has no toggle (it must always exist).
  const panels = manager.allDefs().filter((d) => !isRibbon(d.dockableIn) && d.id !== 'viewport');
  const internal = panels.filter((d) => !isExternalPanelId(d.id));
  const external = panels.filter((d) => isExternalPanelId(d.id));

  const renderToggle = (d: PanelDefinition) => {
    const Icon = PANEL_ICON[d.id] ?? IconLayoutBoard;
    // the live title — a rename from inside the panel (usePanelTitle,
    // ui.dialog.rename) shows here too, not just on the tab
    const title = manager.title(d.id);
    return (
      <RibbonButton
        key={d.id}
        size="mini"
        // no min-width → each column sizes to its own widest label
        // (buttons are w-full, so a column's 3 rows share that width).
        // grab cursor (override the button's default pointer) signals the
        // drag-to-place affordance.
        className="!cursor-grab active:!cursor-grabbing touch-none"
        icon={<Icon />}
        label={title}
        selected={manager.isOpen(d.id)}
        shortcut={hasPanelToggle(d.id) ? panelToggleHotkeyId(d.id) : undefined}
        tooltip={`Click to enable / disable · drag to place the ${title} panel where you want it`}
        // drag it out like a tab; a plain click still toggles (the drag
        // guard skips the click that follows a real drag)
        onPointerDown={(e) => manager.dragPanelFrom(e.nativeEvent, d.id)}
        onClick={() => {
          if (!manager.consumeDragClick()) {
            manager.togglePanel(d.id);
          }
        }}
      />
    );
  };

  return (
    <Ribbon>
      <RibbonSection title="Internal Panels (Drag/Drop)">{internal.map(renderToggle)}</RibbonSection>
      {external.length > 0 && <RibbonSection title="External Panels">{external.map(renderToggle)}</RibbonSection>}
    </Ribbon>
  );
}
