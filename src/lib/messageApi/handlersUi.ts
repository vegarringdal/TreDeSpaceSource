// UI commands (kiosk, theme, panels, dialogs) and the shared instance-data
// blob. App.tsx registers the dock/kiosk/dialog hooks in registry.ts.
import { dialogs } from '../../components/dialogs/dialogs.actions';
import {
  closeExternalModal,
  externalModalsState,
  findExternalModal,
  renameExternalModal,
  setExternalModalHidden,
} from '../../components/panels/ribbon-external/externalModals.state';
import { settingsActions } from '../../components/panels/settings/settings.actions';
import { settingsState } from '../../components/panels/settings/settings.state';
import { releaseHeldClose, setCloseHold } from '../../state/externalCloseHold';
import { forgetDialogId } from '../../state/externalDialogIds';
import { externalPanelsActions, findExternalPanel } from '../../state/externalPanels/externalPanels.actions';
import { externalPanelsState } from '../../state/externalPanels/externalPanels.state';
import { type DialogSnapshot, diffDialogChanges } from './dialogEvents';
import { ApiError, type ApiHandler, isRecord } from './protocol';
import { getInstanceData, getKiosk, getPanelControl, setInstanceData } from './registry';
import { emitApiEvent } from './transport';

const showOrHidePanel: ApiHandler = ({ type, p }) => {
  const panelControl = getPanelControl();
  if (!panelControl) {
    throw new ApiError('internal', 'panel control not registered');
  }
  const panel = typeof p.panel === 'string' ? p.panel : '';
  if (!panel || !panelControl.has(panel)) {
    throw new ApiError('not-found', `no panel named "${panel}"`);
  }
  if (type === 'ui.showPanel') {
    panelControl.open(panel);
    return { shown: true };
  }
  panelControl.close(panel);
  return { hidden: true };
};

/** The external modal dialog id or dock panel id hosting `source`, for the
 *  id-less form of the dialog commands (an embedded app addressing ITSELF).
 *  DOM-only, so it needs no dock-manager registration. */
function dialogIdOfSource(source?: Window | null): string | null {
  if (!source) {
    return null;
  }
  for (const f of document.querySelectorAll('iframe')) {
    if (f.contentWindow === source) {
      return (
        f.closest('[data-ext-modal]')?.getAttribute('data-ext-modal') ??
        f.closest('[data-panel]')?.getAttribute('data-panel') ??
        null
      );
    }
  }
  return null;
}

/** The modal dialog or dock panel a command targets, by its own id. */
type DialogTarget = { kind: 'dialog' | 'panel'; id: string };

/** Resolve the dialog a command targets: an explicit `id` — a dialog id, a
 *  panel id, or the `tdsDialogId` the page sees on its URL — else the sending
 *  window's own dialog or panel. */
function requireDialogTarget(p: Record<string, unknown>, source?: Window | null): DialogTarget {
  const id = typeof p.id === 'string' && p.id ? p.id : dialogIdOfSource(source);
  if (!id) {
    throw new ApiError('bad-payload', 'id is required (no external dialog or panel hosts the sending window)');
  }
  const modal = findExternalModal(id);
  if (modal) {
    return { kind: 'dialog', id: modal.key };
  }
  const panel = findExternalPanel(id);
  if (panel) {
    return { kind: 'panel', id: panel.key };
  }
  throw new ApiError('not-found', `no open dialog or panel with id "${id}"`);
}

// hide/show keep the iframe MOUNTED — the app inside keeps its state, so a
// dialog parked during a load can come back exactly as the user left it.
// Modal dialogs only: a dock panel has no hidden state
const hideOrShowDialog: ApiHandler = ({ type, p, source }) => {
  const { kind, id } = requireDialogTarget(p, source);
  if (kind === 'panel') {
    throw new ApiError('bad-payload', `"${id}" is a panel — only modal dialogs can be hidden and shown`);
  }
  const hidden = type === 'ui.dialog.hide';
  setExternalModalHidden(id, hidden);
  return { id, hidden };
};

/** Close a modal dialog or dock panel, honouring a page's close hold. With
 *  `remove`, forget the instance for good: a panel's definition and remembered
 *  dock location go once the close completes, and the `tdsDialogId` is
 *  dropped so a later open under the same key starts fresh. */
function closeTarget({ kind, id }: DialogTarget, remove: boolean): { id: string; closed: true; removed: boolean } {
  if (kind === 'dialog') {
    closeExternalModal(id, { remove });
    return { id, closed: true, removed: remove };
  }
  const panelControl = getPanelControl();
  if (!panelControl) {
    throw new ApiError('internal', 'panel control not registered');
  }
  if (remove) {
    forgetDialogId(id);
    externalPanelsActions.markRemove(id);
  }
  panelControl.close(id);
  return { id, closed: true, removed: remove };
}

/** Every open external modal dialog and dock panel — what `ui.dialogs` lists
 *  and `dialog.changed` diffs. */
function dialogSnapshot(): DialogSnapshot[] {
  return [
    ...externalModalsState.get().open.map((m) => ({
      kind: 'dialog' as const,
      key: m.key,
      tdsDialogId: m.tdsDialogId,
      appId: m.appId,
      name: m.name,
      url: m.url,
      hidden: m.hidden === true,
      closing: m.closing === true,
    })),
    ...externalPanelsState.get().open.map((p) => ({
      kind: 'panel' as const,
      ...p,
      hidden: false,
      closing: p.closing === true,
    })),
  ];
}

export const uiHandlers: Record<string, ApiHandler> = {
  'ui.kiosk': ({ p }) => {
    const kiosk = getKiosk();
    if (!kiosk) {
      throw new ApiError('internal', 'kiosk control not registered');
    }
    // omit `on` to query, as documented — never toggle by accident
    if (p.on === undefined) {
      return { kiosk: kiosk.get() };
    }
    if (typeof p.on !== 'boolean') {
      throw new ApiError('bad-payload', 'on must be a boolean');
    }
    return { kiosk: kiosk.set(p.on) };
  },

  // omit `theme` to query; otherwise set the viewer's light/dark theme
  'ui.theme': ({ p }) => {
    if (p.theme === undefined) {
      return { theme: settingsState.get().theme };
    }
    if (p.theme !== 'dark' && p.theme !== 'light') {
      throw new ApiError('bad-payload', "theme must be 'dark' or 'light'");
    }
    settingsActions.setTheme(p.theme);
    return { theme: p.theme };
  },

  // close the dialog/panel that hosts the SENDING window (external apps
  // closing themselves, e.g. a project selector after a choice); `remove`
  // forgets the instance for good — the end of one tab of a multi-instance app
  'ui.close': ({ p, source }) => {
    const id = dialogIdOfSource(source);
    if (!id) {
      throw new ApiError('not-found', 'no closable dialog or panel hosts the sending window');
    }
    return closeTarget(requireDialogTarget({ id }, source), p.remove === true);
  },

  'ui.showPanel': showOrHidePanel,
  'ui.hidePanel': showOrHidePanel,

  // modal dialogs AND external-app dock panels, told apart by `kind`
  'ui.dialogs': () => ({
    dialogs: dialogSnapshot().map(({ key, ...rest }) => ({ id: key, ...rest })),
  }),

  'ui.dialog.hide': hideOrShowDialog,
  'ui.dialog.show': hideOrShowDialog,

  'ui.dialog.close': ({ p, source }) => closeTarget(requireDialogTarget(p, source), p.remove === true),

  // retitle a dialog's title bar or a panel's tab — a report list that just
  // opened one report, say. `ui.dialogs`' `name` follows; the app entry is untouched
  'ui.dialog.rename': ({ p, source }) => {
    const { kind, id } = requireDialogTarget(p, source);
    const title = typeof p.title === 'string' ? p.title.trim() : '';
    if (!title) {
      throw new ApiError('bad-payload', 'title is required');
    }
    if (kind === 'dialog') {
      renameExternalModal(id, title);
    } else {
      externalPanelsActions.rename(id, title);
    }
    return { id, title };
  },

  // a page asks to be told before it is unmounted: a close of its dialog /
  // panel then hides it at once, posts dialog.changed 'closing' and waits for
  // ui.dialog.releaseClose (or the timeout) before dropping the iframe
  'ui.dialog.holdClose': ({ p, source }) => {
    const { id } = requireDialogTarget(p, source);
    if (p.timeoutMs !== undefined && (typeof p.timeoutMs !== 'number' || !Number.isFinite(p.timeoutMs))) {
      throw new ApiError('bad-payload', 'timeoutMs must be a number of milliseconds');
    }
    const hold = p.hold !== false;
    const timeoutMs = setCloseHold(id, hold, typeof p.timeoutMs === 'number' ? p.timeoutMs : undefined);
    return { id, hold, ...(timeoutMs === null ? {} : { timeoutMs }) };
  },

  'ui.dialog.releaseClose': ({ p, source }) => {
    const { id } = requireDialogTarget(p, source);
    return { id, released: releaseHeldClose(id) };
  },

  // header = the bold title line; title = the body/message line
  'ui.loading.show': ({ p }) => {
    const header = typeof p.header === 'string' ? p.header : 'Please wait';
    const body = typeof p.title === 'string' ? p.title : 'Loading…';
    dialogs.loading(body, header);
    return {};
  },

  'ui.loading.hide': () => {
    dialogs.hideLoading();
    return {};
  },

  'ui.confirm': async ({ p }) => {
    const question = typeof p.question === 'string' ? p.question : '';
    if (!question) {
      throw new ApiError('bad-payload', 'question is required');
    }
    const confirmed = await dialogs.confirm(question, {
      ...(typeof p.header === 'string' ? { title: p.header } : {}),
      ...(typeof p.yes === 'string' ? { okLabel: p.yes } : {}),
      ...(typeof p.no === 'string' ? { cancelLabel: p.no } : {}),
    });
    return { confirmed };
  },

  'ui.error': ({ p }) => {
    const body = typeof p.title === 'string' ? p.title : '';
    if (!body) {
      throw new ApiError('bad-payload', 'title (message) is required');
    }
    if (typeof p.header === 'string') {
      dialogs.error(body, p.header);
    } else {
      dialogs.error(body);
    }
    return {};
  },

  'instance.set': ({ p }) => {
    if (!isRecord(p.data)) {
      throw new ApiError('bad-payload', 'data must be a JSON object');
    }
    const data = p.merge === true ? { ...getInstanceData(), ...p.data } : { ...p.data };
    setInstanceData(data);
    emitApiEvent('instance.changed', { data });
    return { data };
  },

  'instance.get': () => ({ data: getInstanceData() }),
};

/** `dialog.changed` for hosts and embedded apps: fired from the STORES (modal
 *  dialogs and external-app panels), so every route — the ribbon button, the
 *  ✕, `ui.close`, `ui.dialog.*`, `externalApps.set`, a layout swap dropping a
 *  panel — reports the same way. */
export function installDialogEvents() {
  let prev = dialogSnapshot();
  const sync = () => {
    const next = dialogSnapshot();
    for (const change of diffDialogChanges(prev, next)) {
      emitApiEvent('dialog.changed', change);
    }
    prev = next;
  };
  externalModalsState.subscribe(sync);
  externalPanelsState.subscribe(sync);
}
