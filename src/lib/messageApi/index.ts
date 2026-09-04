// postMessage host API — the app side of EVENTS.md (protocol v1). A thin
// validated adapter: every command maps onto an existing exported action, one
// response per request (same correlation id), origin-allowlisted. Hosts embed
// the app in an iframe (or open it as a window) and drive it with the
// copy-paste SDK in api/tredespace-client.ts; app-embedded External panels
// reach the same listener by posting to window.parent.
//
// This module is the inbound side (listener + command table); the outbound
// side (origin allowlist, emitApiEvent, app.ready) lives in transport.ts, the
// per-domain command implementations in the handlers* modules.
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { apiSecurityActions } from '../../state/apiSecurity.actions';
import { apiSecurityState } from '../../state/apiSecurity.state';
import { assetsActions } from '../../state/assets/assets.actions';
import { storesActions } from '../../state/stores/stores.actions';
import { assetHandlers } from './handlersAssets';
import { externalAppsHandlers } from './handlersExternalApps';
import { sceneHandlers } from './handlersScene';
import { sqlHandlers } from './handlersSql';
import { installDialogEvents, uiHandlers } from './handlersUi';
import { viewerHandlers } from './handlersViewer';
import { ApiError, type ApiHandler, isRecord, PROTOCOL } from './protocol';
import { allowApiOrigins, announceReady, emitApiEvent, isApiReady, markApiReady, originAllowed } from './transport';

export { registerKiosk, registerPanelControl } from './registry';
export { allowApiOrigins, emitApiEvent, markApiReady };

const handlers: Record<string, ApiHandler> = {
  ...sceneHandlers,
  ...viewerHandlers,
  ...assetHandlers,
  ...uiHandlers,
  ...sqlHandlers,
  ...externalAppsHandlers,
};

let installed = false;
export function initMessageApi() {
  // idempotent: the App effect runs twice under StrictMode — a second listener
  // would dispatch every command twice (e.g. one import + one "Import busy")
  if (installed) {
    return;
  }
  installed = true;
  installDialogEvents();
  applyUrlParamOrigins();
  window.addEventListener('message', (e) => void onMessage(e));
}

/** `?apiOrigins=` is trusted as-is only INSIDE AN IFRAME: the browser partitions
 *  storage per embedding site, so an embedder only ever talks to the empty
 *  viewer it opened itself. A TOP-LEVEL window another page opened
 *  (`window.open`) has the user's real OPFS/localStorage — any site could open
 *  `viewer/?apiOrigins=https://evil` on a click and read every database over
 *  the API — so there the parameter is only a request the user must Allow.
 *  A top-level window with no opener has nobody who could post commands. */
function applyUrlParamOrigins() {
  const param = new URLSearchParams(location.search).get('apiOrigins');
  const origins = (param ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origins.length) {
    return;
  }
  if (window.parent !== window) {
    allowApiOrigins(origins);
    return;
  }
  if (window.opener) {
    void requestOriginConsent(origins);
  }
}

/** Ask the user before a popup host's origins join the allowlist. Allow saves
 *  them to Settings → External (removable there) and completes the app.ready
 *  handshake for the waiting host; Deny leaves them ignored for this window.
 *  `*` is never granted this way, and the prompt respects the
 *  "Allow ?apiOrigins= URL parameter" switch. */
async function requestOriginConsent(origins: string[]) {
  if (!apiSecurityState.get().allowUrlParam) {
    return;
  }
  const pending = origins.filter((o) => o !== '*' && !originAllowed(o));
  if (!pending.length) {
    return;
  }
  const ok = await dialogs.confirm(
    `The page that opened this viewer — ${pending.join(', ')} — asks to control it over the postMessage API. ` +
      'It would be able to read and change everything stored in this viewer: models, SQL databases and settings. ' +
      'Allow only if you trust that site. Allowed origins are listed under Settings → External → API security, ' +
      'where they can be removed again.',
    { title: 'Allow API access?', okLabel: 'Allow', cancelLabel: 'Deny' },
  );
  if (!ok) {
    return;
  }
  apiSecurityActions.addOrigins(pending);
  announceReady();
}

async function onMessage(e: MessageEvent) {
  if (!originAllowed(e.origin)) {
    return;
  }
  const d = e.data as {
    tredespace?: number;
    id?: unknown;
    type?: unknown;
    payload?: unknown;
    bytes?: unknown;
  };
  if (d?.tredespace !== PROTOCOL || typeof d.type !== 'string' || typeof d.id !== 'string') {
    return;
  }
  if (d.type.endsWith(':result') || d.type === 'app.ready') {
    return; // our own traffic
  }
  const source = e.source as Window | null;
  if (!source) {
    return;
  }
  const reply = (ok: boolean, body: unknown) =>
    source.postMessage(
      {
        tredespace: PROTOCOL,
        id: d.id,
        type: `${d.type}:result`,
        ok,
        ...(ok ? { payload: body } : { error: body }),
      },
      e.origin === 'null' ? '*' : e.origin,
    );
  if (!isApiReady()) {
    reply(false, { code: 'not-ready', message: 'app is still booting — wait for app.ready' });
    return;
  }
  try {
    reply(true, await dispatch(d.type, isRecord(d.payload) ? d.payload : {}, d.bytes, source));
  } catch (err) {
    if (err instanceof ApiError) {
      reply(false, { code: err.code, message: err.message });
    } else {
      reply(false, { code: 'internal', message: err instanceof Error ? err.message : String(err) });
    }
  }
}

async function dispatch(type: string, p: Record<string, unknown>, bytes: unknown, source?: Window): Promise<unknown> {
  // asset commands need the OPFS index, which the Model Assets panel normally
  // reads on first mount — load it here so the API works before any panel open
  // (init is idempotent: it no-ops once the state is ready)
  if (type.startsWith('assets.') || type.startsWith('stores.')) {
    await storesActions.init();
    await assetsActions.init();
  }
  // SQL commands validate/target stores too, and the filesystem is the SQL
  // index (each command re-scans), so the store registry must be loaded first.
  if (type.startsWith('sql.')) {
    await storesActions.init();
  }
  const handler = handlers[type];
  if (!handler) {
    throw new ApiError('bad-payload', `unknown command ${type}`);
  }
  return await handler({ type, p, bytes, source });
}
