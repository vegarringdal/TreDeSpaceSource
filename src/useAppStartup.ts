import { type DockManager, definePanel } from '@treDeSpaceUI/dockable';
import { useEffect } from 'react';
import { registerClipShapesOpener } from './components/panels/clip-shapes/clipShapesPanel';
import { consoleActions } from './components/panels/console/console.actions';
import { registerExportOpener } from './components/panels/export/exportPanel';
import { registerImportManagerOpener } from './components/panels/import-manager/importManagerPanel';
import { registerLabelsOpener } from './components/panels/labels/labelsPanel';
import { registerMeasurementsOpener } from './components/panels/measurements/measurementsPanel';
import { registerModelAssetsOpener } from './components/panels/model-assets/modelAssetsPanel';
import { registerMultiColorOpener } from './components/panels/multi-color/multiColorPanel';
import {
  closeExternalModal,
  findExternalModal,
  openExternalModal,
} from './components/panels/ribbon-external/externalModals.state';
import {
  externalPanelId,
  makeExternalPanel,
  registerExternalPanels,
} from './components/panels/ribbon-external/externalPanels';
import { registerKioskToggle, registerSoloToggle } from './components/panels/ribbon-home/soloPanels';
import { ribbonMeasurementsActions } from './components/panels/ribbon-measurements/ribbonMeasurements.actions';
import { registerSqlAssetsOpener } from './components/panels/sql-assets/sqlAssetsPanel';
import { SqlDetail } from './components/panels/sql-detail/SqlDetail';
import {
  detailPanelId,
  getDetailAutoRemove,
  registerSqlDetailOpener,
  removeDetailBinding,
} from './components/panels/sql-detail/sqlDetailPanel';
import { registerSqlEditorOpener } from './components/panels/sql-editor/sqlEditorPanel';
import { registerSqlReportsOpener } from './components/panels/sql-reports/sqlReportsPanel';
import { registerSqlTableOpener } from './components/panels/sql-table/sqlTablePanel';
import {
  registerLabelsViewpointOpener,
  registerMeasurementsViewpointOpener,
  registerMultiColorViewpointOpener,
  registerViewpointsOpener,
  registerViewpointViewerOpener,
  registerViewpointViewerRightOpener,
} from './components/panels/viewpoints/viewpointsPanel';
import { viewportOnly } from './lib/appLayout';
import {
  initMessageApi,
  markApiReady,
  registerDialogCloser,
  registerKiosk,
  registerPanelControl,
} from './lib/messageApi';
import { externalAppsState, registerExternalAppOpener } from './state/externalApps.state';
import { dialogIdFor } from './state/externalDialogIds';
import { findTopTabs, layoutsActions, layoutsState, noteActiveRibbon, registerLayoutDock } from './state/layouts.state';
import { initSettingsSync } from './state/settingsSync';

// Greeting banner in the Console — printed once per page load (guarded against
// React's double-invoked effects in dev).
let welcomed = false;
function printWelcome() {
  if (welcomed) {
    return;
  }
  welcomed = true;
  consoleActions.log('info', 'Welcome to TreDeSpace Web Viewer');
  consoleActions.log('info', 'Application made by Vegar Ringdal');
  consoleActions.log(
    'info',
    `© ${new Date().getFullYear()} Vegar Ringdal — TreDeSpace License (Elastic License 2.0 + attribution and public-improvement terms).`,
  );
  consoleActions.log('info', `Version: ${__APP_VERSION__}`);
}

/** One-shot app boot wiring, run once per DockManager: welcome banner, ribbon
 *  and external panels, the postMessage host API (kiosk, dialog closing, panel
 *  control), settings sync, layout slots, and every panel-opener registration. */
export function useAppStartup(manager: DockManager): void {
  useEffect(() => {
    printWelcome(); // greeting banner, once per page load
    // Panel arrangement is NOT auto-remembered across refresh — the dock boots
    // into the default layout, then (after registerLayoutDock, below) into the
    // last SELECTED layout slot if there is one. Edits only stick when the user
    // Saves them into a slot from the Layout ribbon.
    registerExternalPanels(manager); // ensure ribbons + external panels exist
    manager.openPanel('ribbonLayout');
    manager.openPanel('ribbonExternal');
    manager.openPanel('ribbonHome'); // default: land on the Home ribbon

    // postMessage host API (EVENTS.md): ?apiOrigins= read here; Settings
    // origins + external app urls are consulted live per message in
    // messageApi.ts; kiosk = solo panels + collapsed ribbon
    initMessageApi();
    // live settings sync across open instances (storage events from other tabs)
    initSettingsSync();
    let kioskOn = false;
    const setKiosk = (on: boolean) => {
      if (on !== kioskOn) {
        kioskOn = on;
        if (on) {
          // Viewport only: a clean single-viewport layout (no side panels, no
          // console), and `body.kiosk` CSS-hides the top ribbon strip. The
          // strip is locked furniture that heals back if removed, so hiding it
          // is the only way to drop the top toolbar entirely.
          document.body.classList.add('kiosk');
          manager.loadLayout(viewportOnly('ribbonHome'));
        } else {
          // Leaving kiosk always lands on Layout 1 (the Home slot) — not
          // whatever happened to be open before kiosk.
          document.body.classList.remove('kiosk');
          layoutsActions.activate(0);
        }
      }
      return kioskOn;
    };
    registerKiosk({ set: setKiosk, get: () => kioskOn });
    registerKioskToggle(() => setKiosk(!kioskOn));
    if (new URLSearchParams(location.search).get('kiosk') === '1') {
      setKiosk(true);
    }
    // ui.close: find the dialog/panel hosting the sending iframe and close it
    registerDialogCloser((source) => {
      for (const f of document.querySelectorAll('iframe')) {
        if (f.contentWindow !== source) {
          continue;
        }
        const modalKey = f.closest('[data-ext-modal]')?.getAttribute('data-ext-modal');
        if (modalKey) {
          closeExternalModal(modalKey);
          return true;
        }
        const panelId = f.closest('[data-panel]')?.getAttribute('data-panel');
        if (panelId) {
          manager.closePanel(panelId);
          return true;
        }
      }
      return false;
    });
    // ui.showPanel / ui.hidePanel: toggle a dock panel by id (e.g. 'hierarchy')
    registerPanelControl({
      has: (id) => !!manager.getPanel(id),
      open: (id) => {
        if (!manager.getPanel(id)) {
          return false;
        }
        manager.openPanel(id);
        return true;
      },
      close: (id) => {
        if (!manager.getPanel(id)) {
          return false;
        }
        manager.closePanel(id);
        return true;
      },
    });
    // external apps flagged "open on start" (e.g. a project selector)
    for (const a of externalAppsState.get().apps) {
      if (!a.openOnStart || !a.name.trim() || !a.url.trim() || a.newWindow) {
        continue;
      }
      if (a.modal) {
        openExternalModal(a);
      } else {
        manager.openPanel(externalPanelId(a.id));
      }
    }
    // host-set external apps (postMessage externalApps.set) arrive AFTER boot,
    // so their panel defs don't exist yet — register on open, like the ribbon
    registerExternalAppOpener((a) => {
      if (a.modal) {
        const dialogId = openExternalModal(a); // the dialog id the API addresses it by
        return { dialogId, tdsDialogId: findExternalModal(dialogId)?.tdsDialogId ?? '' };
      }
      const id = externalPanelId(a.id);
      manager.registerPanel(makeExternalPanel(id, a));
      manager.openPanel(id);
      return { dialogId: id, tdsDialogId: dialogIdFor(id) };
    });
    markApiReady(__APP_VERSION__);
    // named layout slots (Layout ribbon, F1-F12) drive the manager through these
    registerLayoutDock({
      save: () => manager.saveLayout(),
      load: (state) => manager.loadLayout(state),
      openRibbon: (id) => manager.openPanel(id),
      setRibbonOpen: (open) => manager.setCollapsed('top', !open),
    });
    // boot into the layout slot we were last using (panels themselves aren't
    // remembered — only which slot is selected)
    const usingSlot = layoutsState.get().selected;
    if (usingSlot != null) {
      layoutsActions.activate(usingSlot);
    }
    registerMeasurementsOpener(() => manager.openPanel('measurements'));
    registerClipShapesOpener(() => manager.openPanel('clipShapes'));
    registerModelAssetsOpener(() => manager.openPanelBeside('modelAssets', 'hierarchy', 'right'));
    registerSqlAssetsOpener(() => manager.openPanelBeside('sqlAssets', 'hierarchy', 'right'));
    registerSqlEditorOpener(() => manager.openPanel('sqlEditor'));
    registerSqlReportsOpener(() => manager.openPanelBeside('sqlReports', 'hierarchy', 'right'));
    registerSqlTableOpener(() => manager.openPanel('sqlTable'));
    // a NAMED detail panel is created on demand (session-only, like a
    // host-managed external app); the built-in one is already defined
    registerSqlDetailOpener((key, title) => {
      const id = detailPanelId(key);
      if (key) {
        manager.registerPanel(
          definePanel({
            id,
            title,
            home: 'right',
            component: SqlDetail,
            // closing a named panel throws it away unless its Keep toggle is
            // on — a layout swap does NOT count as a close (see onClose)
            onClose: () => {
              if (!getDetailAutoRemove(key)) {
                return;
              }
              removeDetailBinding(key);
              manager.unregisterPanel(id);
            },
          }),
        );
      }
      manager.openPanel(id);
    });
    registerImportManagerOpener(() => manager.openPanel('importManager'));
    registerMultiColorOpener(() => manager.openPanel('multiColor'));
    registerLabelsOpener(() => manager.openPanel('labels'));
    registerExportOpener(() => manager.openPanel('export'));
    registerViewpointsOpener(() => manager.openPanel('viewpoints'));
    registerViewpointViewerOpener(() => manager.openPanel('viewpointViewer'));
    registerViewpointViewerRightOpener(() => {
      manager.openPanel('viewpointViewer', 'right');
      manager.focusPanel('viewpointViewer');
    });
    registerLabelsViewpointOpener(() => manager.openPanel('labelsViewpoint'));
    registerMeasurementsViewpointOpener(() => manager.openPanel('measurementsViewpoint'));
    registerMultiColorViewpointOpener(() => manager.openPanel('multiColorViewpoint'));
    registerSoloToggle(() => manager.toggleSolo());
    let activeRibbon = findTopTabs(manager.saveLayout().root)?.activePanel;
    const unsubLayout = manager.subscribe(() => {
      try {
        // remember the last REAL ribbon tab so a slot Save records it (not the
        // Layout ribbon the user switches to for the Save click). The panel
        // arrangement itself is deliberately NOT persisted on edit.
        const next = findTopTabs(manager.saveLayout().root)?.activePanel;
        noteActiveRibbon(next);
        if (next !== activeRibbon) {
          // leaving the Measurements ribbon disarms its tool ("Off when
          // ribbon switch", default on)
          ribbonMeasurementsActions.ribbonChanged(activeRibbon, next);
          activeRibbon = next;
        }
      } catch {
        // non-fatal
      }
    });
    // a layout slot switch (Layout ribbon / F-keys) disarms it too, even when
    // the slot lands on the Measurements ribbon again
    let selectedSlot = layoutsState.get().selected;
    const unsubSlots = layoutsState.subscribe(() => {
      const sel = layoutsState.get().selected;
      if (sel !== selectedSlot) {
        selectedSlot = sel;
        ribbonMeasurementsActions.layoutSwitched();
      }
    });
    return () => {
      unsubLayout();
      unsubSlots();
    };
  }, [manager]);
}
