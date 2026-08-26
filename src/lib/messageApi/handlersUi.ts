// UI commands (kiosk, theme, panels, dialogs) and the shared instance-data
// blob. App.tsx registers the dock/kiosk/dialog hooks in registry.ts.
import { dialogs } from '../../components/dialogs/dialogs.actions';
import {
  closeExternalModal,
  externalModalsState,
  setExternalModalHidden,
} from '../../components/panels/ribbon-external/externalModals.state';
import { settingsActions } from '../../components/panels/settings/settings.actions';
import { settingsState } from '../../components/panels/settings/settings.state';
import { ApiError, type ApiHandler, isRecord } from './protocol';
import { getDialogCloser, getInstanceData, getKiosk, getPanelControl, setInstanceData } from './registry';
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

/** The external-modal dialog id hosting `source`, for the id-less form of the
 *  dialog commands (an embedded app addressing ITSELF). DOM-only, so it needs
 *  no dock-manager registration. */
function dialogIdOfSource(source?: Window | null): string | null {
  if (!source) {
    return null;
  }
  for (const f of document.querySelectorAll('iframe')) {
    if (f.contentWindow === source) {
      return f.closest('[data-ext-modal]')?.getAttribute('data-ext-modal') ?? null;
    }
  }
  return null;
}

/** Resolve the dialog a command targets: an explicit `id`, else the sending
 *  window's own dialog. */
function requireDialogId(p: Record<string, unknown>, source?: Window | null): string {
  const id = typeof p.id === 'string' && p.id ? p.id : dialogIdOfSource(source);
  if (!id) {
    throw new ApiError('bad-payload', 'id is required (no external dialog hosts the sending window)');
  }
  if (!externalModalsState.get().open.some((m) => m.key === id)) {
    throw new ApiError('not-found', `no open dialog with id "${id}"`);
  }
  return id;
}

const hideOrShowDialog: ApiHandler = ({ type, p, source }) => {
  const id = requireDialogId(p, source);
  const hidden = type === 'ui.dialog.hide';
  setExternalModalHidden(id, hidden);
  return { id, hidden };
};

export const uiHandlers: Record<string, ApiHandler> = {
  'ui.kiosk': ({ p }) => {
    const kiosk = getKiosk();
    if (!kiosk) {
      throw new ApiError('internal', 'kiosk control not registered');
    }
    const on = typeof p.on === 'boolean' ? p.on : !kiosk.get();
    return { kiosk: kiosk.set(on) };
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
  // closing themselves, e.g. a project selector after a choice)
  'ui.close': ({ source }) => {
    if (!source || !getDialogCloser()?.(source)) {
      throw new ApiError('not-found', 'no closable dialog or panel hosts the sending window');
    }
    return { closed: true };
  },

  'ui.showPanel': showOrHidePanel,
  'ui.hidePanel': showOrHidePanel,

  'ui.dialogs': () => ({
    dialogs: externalModalsState.get().open.map((m) => ({
      id: m.key,
      appId: m.appId,
      name: m.name,
      url: m.url,
      hidden: m.hidden === true,
    })),
  }),

  // hide/show keep the iframe MOUNTED — the app inside keeps its state, so a
  // dialog parked during a load can come back exactly as the user left it
  'ui.dialog.hide': hideOrShowDialog,
  'ui.dialog.show': hideOrShowDialog,

  'ui.dialog.close': ({ p, source }) => {
    const id = requireDialogId(p, source);
    closeExternalModal(id);
    return { id, closed: true };
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
