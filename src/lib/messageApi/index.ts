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
import { dropClient, forgetBatchOwner, noteBatchOwner, touchClient } from './clients';
import { appHandlers } from './handlersApp';
import { assetHandlers } from './handlersAssets';
import { consoleHandlers } from './handlersConsole';
import { customHandlers } from './handlersCustom';
import { externalAppsHandlers } from './handlersExternalApps';
import { sceneHandlers } from './handlersScene';
import { settingsHandlers } from './handlersSettings';
import { sqlHandlers } from './handlersSql';
import { installDialogEvents, uiHandlers } from './handlersUi';
import { viewerHandlers } from './handlersViewer';
import { ApiError, type ApiHandler } from './protocol';
import {
  allowApiOrigins,
  announceReady,
  announceReadyTo,
  emitApiEvent,
  isApiReady,
  markApiReady,
  originAllowed,
  registerCommandList,
} from './transport';
import { answerCommand, classifyInbound, replyOrigin, resultEnvelope } from './wire';

export { registerKiosk, registerPanelControl } from './registry';
export { allowApiOrigins, emitApiEvent, markApiReady };

const handlers: Record<string, ApiHandler> = {
  ...appHandlers,
  ...sceneHandlers,
  ...viewerHandlers,
  ...settingsHandlers,
  ...assetHandlers,
  ...uiHandlers,
  ...sqlHandlers,
  ...externalAppsHandlers,
  ...consoleHandlers,
  ...customHandlers,
};
registerCommandList(Object.keys(handlers));

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
  // the app says goodbye on the way out (reload, navigation, close, bfcache)
  // so hosts can show "not connected", and re-announces ready when the page
  // comes back from the back-forward cache (no boot happens then)
  window.addEventListener('pagehide', () => emitApiEvent('app.bye', { reason: 'unload' }));
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      announceReady();
    }
  });
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
  const source = e.source as Window | null;
  const inbound = classifyInbound(e.data, originAllowed(e.origin), source !== null);
  if (inbound.kind === 'ignore' || !source) {
    return;
  }
  // every sender is a client from its first message (custom.* identity,
  // app-event subscription, batch ownership)
  touchClient(source, e.origin);
  // the SDK's id-less notes: hello gets app.ready (a late-arriving page —
  // panel, dialog, a tab we opened — resolves ready() on it); bye (dispose /
  // page unload) forgets the client — its bus subscription with it
  if (inbound.kind === 'hello') {
    announceReadyTo(source, e.origin);
    return;
  }
  if (inbound.kind === 'bye') {
    dropClient(source);
    return;
  }
  const answer = await answerCommand(inbound, isApiReady(), (type, p, bytes) => dispatch(type, p, bytes, source));
  source.postMessage(resultEnvelope(inbound.id, inbound.type, answer), replyOrigin(e.origin));
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
    throw new ApiError('unknown-command', `unknown command ${type} — app.info lists what this viewer has`);
  }
  // a command with a batchId owns that batch while it runs: its progress
  // events reach the issuing window only (transport.ts emitApiEvent)
  const batchId = typeof p.batchId === 'string' && source ? p.batchId : null;
  if (batchId && source) {
    noteBatchOwner(batchId, source);
  }
  try {
    return await handler({ type, p, bytes, source });
  } finally {
    if (batchId) {
      forgetBatchOwner(batchId);
    }
  }
}
