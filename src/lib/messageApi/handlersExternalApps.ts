// External-app commands: a hosting page configures the External ribbon for
// its context. Host-set entries are SESSION-ONLY (never persisted, not
// editable in Settings) — a reload drops them until the host sets them again
// after app.ready, so a viewer opened without its host simply has none.
// See EVENTS.md for the payload contracts.

import { externalModalsState } from '../../components/panels/ribbon-external/externalModals.state';
import {
  isViewerOriginUrl,
  PERMISSION_OPTIONS,
  type PolicyOptionDoc,
  readPermissionOptions,
  readSandboxOptions,
  SANDBOX_OPTIONS,
  VIEWER_ORIGIN_WARNING,
} from '../../state/externalAppPolicy';
import {
  type ExternalApp,
  type ExternalAppSize,
  externalAppsActions,
  externalAppsState,
  openExternalAppNow,
} from '../../state/externalApps.state';
import { ApiError, type ApiHandler, isRecord, records } from './protocol';

const SIZES: ReadonlySet<string> = new Set(['big', 'medium', 'small']);
/** A host-chosen app id: short, URL- and layout-safe. */
const HOST_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

type HostAppInput = Omit<ExternalApp, 'id' | 'hostManaged'> & { id?: string };

/** One optional policy list (`sandbox` / `allow`): absent = empty; anything
 *  else must be an array of known options — unknown ones are rejected rather
 *  than dropped, so a host learns its typo instead of silently getting less. */
function policyList<T extends string>(
  f: Record<string, unknown>,
  key: 'sandbox' | 'allow',
  read: (v: unknown) => { list: T[]; unknown: string[] },
  accepted: readonly PolicyOptionDoc<T>[],
  i: number,
): T[] {
  const raw = f[key];
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ApiError('bad-payload', `apps[${i}].${key} must be an array`);
  }
  const { list, unknown } = read(raw);
  if (unknown.length) {
    const names = accepted.map((o) => o.value).join(', ');
    throw new ApiError(
      'bad-payload',
      `apps[${i}].${key}: unknown option(s) ${unknown.join(', ')} — accepted: ${names}`,
    );
  }
  return list;
}

/** Validate one `externalApps.set` entry into the store's shape. `id` is
 *  optional — given, it must be a short safe token and makes the entry stable
 *  across calls. */
function parseApp(f: Record<string, unknown>, i: number): HostAppInput {
  const name = typeof f.name === 'string' ? f.name.trim() : '';
  const url = typeof f.url === 'string' ? f.url.trim() : '';
  if (!name || !url) {
    throw new ApiError('bad-payload', `apps[${i}] needs a non-empty name and url`);
  }
  if (f.id !== undefined && (typeof f.id !== 'string' || !HOST_ID.test(f.id))) {
    throw new ApiError('bad-payload', `apps[${i}].id must be 1–64 of letters, digits, _ . : -`);
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
    ...(typeof f.id === 'string' ? { id: f.id } : {}),
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
    sandbox: policyList(f, 'sandbox', readSandboxOptions, SANDBOX_OPTIONS, i),
    allow: policyList(f, 'allow', readPermissionOptions, PERMISSION_OPTIONS, i),
  };
}

export const externalAppsHandlers: Record<string, ApiHandler> = {
  'externalApps.set': async ({ p }) => {
    const apps = records(p.apps, 'apps').map(parseApp);
    // a host id must be unique in the call and must not hijack a user's entry
    const userIds = new Set(
      externalAppsState
        .get()
        .apps.filter((a) => !a.hostManaged)
        .map((a) => a.id),
    );
    const seen = new Set<string>();
    apps.forEach((a, i) => {
      if (a.id === undefined) {
        return;
      }
      if (seen.has(a.id) || userIds.has(a.id)) {
        throw new ApiError('bad-payload', `apps[${i}].id "${a.id}" is already used`);
      }
      seen.add(a.id);
    });
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
        // present for a MODAL app opened by this call — what ui.dialog.* uses,
        // plus the ?tdsDialogId= its page sees
        ...(dialogIds.has(a.id)
          ? {
              dialogId: dialogIds.get(a.id),
              tdsDialogId: externalModalsState.get().open.find((m) => m.key === dialogIds.get(a.id))?.tdsDialogId,
            }
          : {}),
        // a page on the viewer's own origin is beyond what any sandbox isolates
        ...(isViewerOriginUrl(a.url) ? { warning: VIEWER_ORIGIN_WARNING } : {}),
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
      sandbox: a.sandbox ?? [],
      allow: a.allow ?? [],
      hostManaged: a.hostManaged === true,
    })),
  }),
};
