// External-app commands: a hosting page configures the External ribbon for
// its context. Host-set entries are SESSION-ONLY (never persisted, not
// editable in Settings) — a reload drops them until the host sets them again
// after app.ready, so a viewer opened without its host simply has none.
// See EVENTS.md for the payload contracts.
import {
  type ExternalApp,
  type ExternalAppSize,
  externalAppsActions,
  externalAppsState,
  openExternalAppNow,
} from '../../state/externalApps.state';
import { ApiError, type ApiHandler, isRecord, records } from './protocol';

const SIZES: ReadonlySet<string> = new Set(['big', 'medium', 'small']);

/** Validate one `externalApps.set` entry into the store's shape (sans id). */
function parseApp(f: Record<string, unknown>, i: number): Omit<ExternalApp, 'id' | 'hostManaged'> {
  const name = typeof f.name === 'string' ? f.name.trim() : '';
  const url = typeof f.url === 'string' ? f.url.trim() : '';
  if (!name || !url) {
    throw new ApiError('bad-payload', `apps[${i}] needs a non-empty name and url`);
  }
  try {
    void new URL(url, location.href);
  } catch {
    throw new ApiError('bad-payload', `apps[${i}].url is not a valid URL`);
  }
  const size = typeof f.size === 'string' && SIZES.has(f.size) ? (f.size as ExternalAppSize) : 'medium';
  // config: accept an object (stringified onto the wire's ?config= param) or a string
  const config = isRecord(f.config) ? JSON.stringify(f.config) : typeof f.config === 'string' ? f.config : '';
  return {
    name,
    url,
    multiple: f.multiple === true,
    section: typeof f.section === 'string' ? f.section : '',
    size,
    tooltip: typeof f.tooltip === 'string' ? f.tooltip : '',
    newWindow: f.newWindow === true,
    openOnStart: f.openOnStart === true,
    home: f.home === true,
    homeAt: f.homeAt === 'end' ? 'end' : 'start',
    modal: f.modal === true,
    config,
  };
}

export const externalAppsHandlers: Record<string, ApiHandler> = {
  'externalApps.set': async ({ p }) => {
    const apps = records(p.apps, 'apps').map(parseApp);
    const created = externalAppsActions.setHostManaged(apps);
    // openOnStart on a host entry = open NOW (the host sets apps after boot);
    // new-window entries are skipped — window.open without a gesture is blocked
    let opened = 0;
    const dialogIds = new Map<string, string>();
    for (const a of created) {
      if (!a.openOnStart) {
        continue;
      }
      const r = openExternalAppNow(a);
      if (r.opened) {
        opened++;
      }
      if (r.dialogId) {
        dialogIds.set(a.id, r.dialogId);
      }
    }
    return {
      apps: created.map((a) => ({
        id: a.id,
        name: a.name,
        url: a.url,
        // present for a MODAL app opened by this call — what ui.dialog.* uses
        ...(dialogIds.has(a.id) ? { dialogId: dialogIds.get(a.id) } : {}),
      })),
      opened,
    };
  },

  'externalApps.list': async () => ({
    apps: externalAppsState.get().apps.map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      section: a.section,
      size: a.size,
      multiple: a.multiple,
      newWindow: a.newWindow,
      modal: a.modal,
      openOnStart: a.openOnStart,
      home: a.home,
      homeAt: a.homeAt,
      hostManaged: a.hostManaged === true,
    })),
  }),
};
