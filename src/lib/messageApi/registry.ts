// App-side hooks the API dispatches through: App.tsx owns the dock manager
// and registers kiosk/panel/dialog control here, and external dialogs share
// one in-memory instance-data blob per viewer window.

// -----------------------------------------------------------------------------
// kiosk control (App.tsx owns the dock manager and registers this)
// -----------------------------------------------------------------------------

type KioskControl = { set(on: boolean): boolean; get(): boolean };
let kiosk: KioskControl | null = null;

export function registerKiosk(k: KioskControl | null) {
  kiosk = k;
}

export function getKiosk(): KioskControl | null {
  return kiosk;
}

/** ui.close: App.tsx registers how to close the dialog/panel hosting a given
 *  window (external modal → close it; dock panel → closePanel). Returns
 *  whether something was closed. */
let dialogCloser: ((source: Window) => boolean) | null = null;

export function registerDialogCloser(fn: (source: Window) => boolean) {
  dialogCloser = fn;
}

export function getDialogCloser(): ((source: Window) => boolean) | null {
  return dialogCloser;
}

/** ui.showPanel / ui.hidePanel: App.tsx registers open/close/has against the
 *  DockManager so the API can toggle panels (e.g. the Hierarchy) by id. */
type PanelControl = { open(id: string): boolean; close(id: string): boolean; has(id: string): boolean };
let panelControl: PanelControl | null = null;

export function registerPanelControl(c: PanelControl | null) {
  panelControl = c;
}

export function getPanelControl(): PanelControl | null {
  return panelControl;
}

/** instance data: one shared in-memory JSON object per viewer window —
 *  external dialogs coordinate through it (e.g. a project selector sets it,
 *  other dialogs read it / listen for instance.changed). Not persisted. */
let instanceData: Record<string, unknown> = {};

export function getInstanceData(): Record<string, unknown> {
  return instanceData;
}

export function setInstanceData(data: Record<string, unknown>): void {
  instanceData = data;
}
