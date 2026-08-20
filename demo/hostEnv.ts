// Which viewer this demo drives, resolved once at load.

// -----------------------------------------------------------------------------
// which viewer to embed
// -----------------------------------------------------------------------------
// Edit this to point the demo at a specific viewer — e.g. 'https://tredespace.com'
// to drive production from localhost. Leave '' to embed the app one level up from
// /demo/ (resolved relatively, so a sub-path deploy still works). A ?app=<url>
// query param overrides it at runtime.
const IFRAME_URL = '';

// We append ?apiOrigins= so the viewer allowlists this host — exactly what a real
// cross-origin host does (the viewer must also have the API enabled and the
// "Allow ?apiOrigins=" toggle on — both default on). For a CROSS-ORIGIN viewer
// the SDK's targetOrigin MUST be the viewer's origin (APP_ORIGIN), not ours,
// or the browser drops every postMessage on an origin mismatch.
const appParam = new URLSearchParams(location.search).get('app');
const appBase = new URL(appParam || IFRAME_URL || '..', location.href).href;

export const APP_URL = `${appBase}${appBase.includes('?') ? '&' : '?'}apiOrigins=${encodeURIComponent(location.origin)}`;
export const APP_ORIGIN = new URL(APP_URL).origin;

/** ?dialog=1 — this page is HOSTED INSIDE the viewer (External app panel /
 *  dialog): no iframe, just actions + console, driving window.parent. */
export const IS_DIALOG = new URLSearchParams(location.search).has('dialog');

/** Host-provided config (?config=<stringified json> from Settings → External). */
export const CONFIG_PARAM = new URLSearchParams(location.search).get('config');
