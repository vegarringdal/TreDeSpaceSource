import { DockView, useDockManager } from '@treDeSpaceUI/dockable';
import { initTooltips } from '@treDeSpaceUI/widgets';
import { panels } from './appPanels';
import { DialogHost } from './components/dialogs';
import { ExternalModals } from './components/panels/ribbon-external/ExternalModals';
import { initTheme } from './components/panels/settings/settings.actions';
import { installHotkeys } from './hotkeys/bindings';
import { defaultLayout } from './lib/appLayout';
import { viewerState } from './state/viewer/viewer.state';
import { useAppStartup } from './useAppStartup';

initTooltips(); // one global listener; anything with data-tooltip gets one
initTheme(); // apply the persisted/default theme before first paint
installHotkeys(); // global keyboard shortcuts (validates defaults, starts the engine)
// per-session view modes: every page load starts perspective with sketch off,
// no matter what the persisted viewer settings (or another tab) say
viewerState.set({ orthographic: false, sketch: false });

/** Root shell: the dock (all panels + viewport), external-app modals, and the
 *  dialog host. All boot wiring lives in useAppStartup. */
export function App() {
  const manager = useDockManager(() => ({ panels, layout: defaultLayout }));

  useAppStartup(manager);

  return (
    <>
      <DockView manager={manager} className="studio" />
      <ExternalModals />
      <DialogHost />
    </>
  );
}
