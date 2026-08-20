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
import { usePanelContext } from '@treDeSpaceUI/dockable';
import { Ribbon, RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { type ForwardRefExoticComponent, type RefAttributes, useSyncExternalStore } from 'react';

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
 *  sync however a panel is opened/closed), plus save / restore / reset of the
 *  whole layout. Closing then toggling a panel back returns it where it was. */
export function RibbonPanels() {
  const { manager } = usePanelContext();
  // re-render on any layout change (open/close/move/float)
  useSyncExternalStore(
    (cb) => manager.subscribe(cb),
    () => manager.version,
  );

  // The viewport is the app's canvas — it has no toggle (it must always exist).
  const panels = manager.allDefs().filter((d) => !isRibbon(d.dockableIn) && d.id !== 'viewport');

  return (
    <Ribbon>
      <RibbonSection title="Panel (drag/drop to place where you want it)">
        {panels.map((d) => {
          const Icon = PANEL_ICON[d.id] ?? IconLayoutBoard;
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
              label={d.title}
              selected={manager.isOpen(d.id)}
              tooltip={`Click to enable / disable · drag to place the ${d.title} panel where you want it`}
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
        })}
      </RibbonSection>
    </Ribbon>
  );
}
