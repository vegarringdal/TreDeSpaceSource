// UI commands (kiosk, theme, panels, dialogs) and the shared instance-data
// blob. App.tsx registers the dock/kiosk/dialog hooks in registry.ts.
import { dialogs } from '../../components/dialogs/dialogs.actions';
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
