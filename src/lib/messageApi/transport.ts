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

/** Post app.ready to the parent/opener for every allowed origin. Also re-run
 *  when the allowlist grows AFTER boot (a `?apiOrigins=` popup host the user
 *  just allowed) so a host waiting on the handshake gets it. */
export function announceReady() {
  if (!apiReady) {
    return;
  }
  const ready = {
    tredespace: PROTOCOL,
    id: null,
    type: 'app.ready',
    ok: true,
    payload: { version: readyVersion, api: PROTOCOL },
  };
  const targets: (Window | null)[] = [window.parent !== window ? window.parent : null, window.opener as Window | null];
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
