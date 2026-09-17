// Transport layer of the postMessage host API: the live origin allowlist and
// the app → host message paths (unsolicited events + the app.ready announce),
// plus what the handshake advertises (command list, event list, GPU state).
import { apiSecurityState } from '../../state/apiSecurity.state';
import { externalAppOrigins } from '../../state/externalApps.state';
import { API_EVENTS } from './apiEvents';
import { batchOwnerClient, isKnownClient, liveClients, postToClient, wantsAppEvent } from './clients';
import { isRecord, PROTOCOL } from './wire';

// -----------------------------------------------------------------------------
// origin allowlist, consulted LIVE on every message: master switch +
// same-origin + Settings→External origins + configured External app urls +
// (optionally) ?apiOrigins= from the embedding URL
// -----------------------------------------------------------------------------
const urlParamOrigins: string[] = [];

export function allowApiOrigins(origins: string[]) {
  for (const o of origins) {
    if (o && !urlParamOrigins.includes(o)) {
      urlParamOrigins.push(o);
    }
  }
}

export function originAllowed(o: string): boolean {
  const sec = apiSecurityState.get();
  if (!sec.enabled) {
    return false;
  }
  if (o === location.origin) {
    return true;
  }
  if (sec.origins.includes(o) || sec.origins.includes('*')) {
    return true;
  }
  if (externalAppOrigins().includes(o)) {
    return true;
  }
  if (sec.allowUrlParam && (urlParamOrigins.includes(o) || urlParamOrigins.includes('*'))) {
    return true;
  }
  return false;
}

let apiReady = false;

export function isApiReady(): boolean {
  return apiReady;
}

// -----------------------------------------------------------------------------
// windows this viewer opened (External apps in tab mode): they hold us as
// window.opener and drive us directly, so events go to them as well. Pruned
// as they close; lost on a viewer reload (the tab reloads to reconnect).
// -----------------------------------------------------------------------------
const openedWindows = new Set<Window>();

export function registerOpenedWindow(win: Window) {
  openedWindows.add(win);
}

function liveOpenedWindows(): Window[] {
  for (const w of openedWindows) {
    if (w.closed) {
      openedWindows.delete(w);
    }
  }
  return [...openedWindows];
}

/** Every allowed-origin candidate (for outbound messages, `*` excluded).
 *  DEDUPED — the same origin often appears via several sources (same-origin +
 *  ?apiOrigins= + an external-app url), and posting to one window once per
 *  duplicate would deliver the same message several times. */
function allowedOriginCandidates(): string[] {
  const sec = apiSecurityState.get();
  return [
    ...new Set(
      [location.origin, ...sec.origins, ...externalAppOrigins(), ...(sec.allowUrlParam ? urlParamOrigins : [])].filter(
        (o) => o !== '*',
      ),
    ),
  ];
}

/** The windows that get app → host traffic without ever having sent a
 *  message: the parent, the opener and the windows this viewer opened. */
function legacyTargets(): Window[] {
  const targets: (Window | null)[] = [
    window.parent !== window ? window.parent : null,
    window.opener as Window | null,
    ...liveOpenedWindows(),
  ];
  return targets.filter((t): t is Window => t !== null);
}

/** Post one envelope to a window once per allowed origin — the only way to
 *  reach a window whose origin is not known yet. */
function broadcast(t: Window, msg: unknown, origins: string[]): void {
  for (const o of origins) {
    try {
      t.postMessage(msg, o);
    } catch {
      // cross-origin target that doesn't match this origin — expected
    }
  }
}

/** Unsolicited app → host event (id: null). Delivery, in order:
 *  - a payload with a `batchId` is progress for one command — it goes to the
 *    window that issued it and nobody else;
 *  - every registered client (anything that has sent a message: the SDK says
 *    hello on construction) gets it ONCE at its exact origin, if its
 *    `events.subscribe` filter admits the type (`app.*` always does);
 *  - the parent / opener / opened windows that never sent a message keep the
 *    old broadcast — once per allowed origin — so a hand-rolled host that
 *    only listens still hears everything. */
export function emitApiEvent(type: string, payload: unknown) {
  if (!apiSecurityState.get().enabled) {
    return;
  }
  const batchId = isRecord(payload) && typeof payload.batchId === 'string' ? payload.batchId : null;
  const owner = batchId ? batchOwnerClient(batchId) : null;
  if (owner) {
    postToClient(owner, type, payload);
    return;
  }
  for (const c of liveClients()) {
    if (wantsAppEvent(c, type)) {
      postToClient(c, type, payload);
    }
  }
  const msg = { tredespace: PROTOCOL, id: null, type, ok: true, payload };
  const origins = allowedOriginCandidates();
  for (const t of legacyTargets()) {
    if (!isKnownClient(t)) {
      broadcast(t, msg, origins);
    }
  }
}

// -----------------------------------------------------------------------------
// what the handshake advertises
// -----------------------------------------------------------------------------

let readyVersion = '';
let commandNames: string[] = [];

/** The renderer's state as far as the API can tell a host: the viewport
 *  boots in parallel with the API, so `app.ready` usually says `booting`;
 *  `app.info` gives the current answer and `app.error` reports a failure. */
export type GpuState = 'booting' | 'ok' | 'failed';
let gpu: GpuState = 'booting';

/** index.ts registers its command table here so the handshake can list it. */
export function registerCommandList(names: readonly string[]) {
  commandNames = [...names].sort();
}

export function setGpuState(state: GpuState) {
  gpu = state;
}

export function getGpuState(): GpuState {
  return gpu;
}

/** The `app.ready` payload — also `app.info`'s response. */
export function readyPayload() {
  return { version: readyVersion, api: PROTOCOL, commands: commandNames, events: [...API_EVENTS], gpu };
}

/** Boot complete: answer commands and announce app.ready to parent/opener. */
export function markApiReady(version: string) {
  apiReady = true;
  readyVersion = version;
  announceReady();
}

function readyEnvelope() {
  return { tredespace: PROTOCOL, id: null, type: 'app.ready', ok: true, payload: readyPayload() };
}

/** Post app.ready to the parent/opener for every allowed origin. Also re-run
 *  when the allowlist grows AFTER boot (a `?apiOrigins=` popup host the user
 *  just allowed) so a host waiting on the handshake gets it. */
export function announceReady() {
  if (!apiReady) {
    return;
  }
  const ready = readyEnvelope();
  const origins = allowedOriginCandidates();
  for (const t of legacyTargets()) {
    broadcast(t, ready, origins);
  }
}

/** Answer one client's `client.hello` with app.ready — a page that arrived
 *  after boot (an External-app panel, a tab we opened) resolves its
 *  `ready()` this way instead of pinging a command. Silent until ready: the
 *  boot announce reaches it then, if it is a parent/opener/opened window. */
export function announceReadyTo(win: Window, origin: string) {
  if (!apiReady) {
    return;
  }
  try {
    win.postMessage(readyEnvelope(), origin === 'null' ? '*' : origin);
  } catch {
    // window gone — nothing to answer
  }
}
