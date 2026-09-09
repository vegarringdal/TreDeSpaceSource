// Transport layer of the postMessage host API: the live origin allowlist and
// the app → host message paths (unsolicited events + the app.ready announce).
import { apiSecurityState } from '../../state/apiSecurity.state';
import { externalAppOrigins } from '../../state/externalApps.state';
import { PROTOCOL } from './protocol';

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

/** Unsolicited app → host event (id: null): posted to the parent window, the
 *  opener, AND every embedded iframe on an allowed origin (external-app
 *  panels/dialogs) — so both "hosted" and "hosting" setups can listen. */
export function emitApiEvent(type: string, payload: unknown) {
  if (!apiSecurityState.get().enabled) {
    return;
  }
  const msg = { tredespace: PROTOCOL, id: null, type, ok: true, payload };
  const origins = allowedOriginCandidates();
  const targets = new Set<Window>();
  if (window.parent !== window) {
    targets.add(window.parent);
  }
  if (window.opener) {
    targets.add(window.opener as Window);
  }
  for (const w of liveOpenedWindows()) {
    targets.add(w);
  }
  for (const f of document.querySelectorAll('iframe')) {
    try {
      if (f.contentWindow && origins.includes(new URL(f.src, location.href).origin)) {
        targets.add(f.contentWindow);
      }
    } catch {
      // unparsable src — skip
    }
  }
  for (const t of targets) {
    for (const o of origins) {
      try {
        t.postMessage(msg, o);
      } catch {
        // cross-origin target that doesn't match this origin — expected
      }
    }
  }
}

let readyVersion = '';

/** Boot complete: answer commands and announce app.ready to parent/opener. */
export function markApiReady(version: string) {
  apiReady = true;
  readyVersion = version;
  announceReady();
}

function readyEnvelope() {
  return {
    tredespace: PROTOCOL,
    id: null,
    type: 'app.ready',
    ok: true,
    payload: { version: readyVersion, api: PROTOCOL },
  };
}

/** Post app.ready to the parent/opener for every allowed origin. Also re-run
 *  when the allowlist grows AFTER boot (a `?apiOrigins=` popup host the user
 *  just allowed) so a host waiting on the handshake gets it. */
export function announceReady() {
  if (!apiReady) {
    return;
  }
  const ready = readyEnvelope();
  const targets: (Window | null)[] = [
    window.parent !== window ? window.parent : null,
    window.opener as Window | null,
    ...liveOpenedWindows(),
  ];
  const origins = allowedOriginCandidates();
  for (const t of targets) {
    if (!t) {
      continue;
    }
    for (const o of origins) {
      try {
        t.postMessage(ready, o);
      } catch {
        // cross-origin target that doesn't match this origin — expected
      }
    }
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
