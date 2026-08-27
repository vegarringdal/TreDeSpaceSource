// Links to product pages (docs, demo, downloads). A deployed viewer may live
// on a customer's host or inside an iframe on any origin, so a relative
// `docs/` would point at whatever is serving the app — not the product site.
// Only a dev / localhost instance (where the pages are being edited) resolves
// relative to itself; everything else goes to the canonical site.

export const PRODUCT_SITE = 'https://tredespace.com';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Pure resolver — `env` is explicit so it can be unit-tested. */
export function resolveProductUrl(path: string, env: { dev: boolean; hostname: string; baseURI: string }): string {
  const rel = path.replace(/^\/+/, '');
  if (env.dev || LOCAL_HOSTS.has(env.hostname)) {
    return new URL(rel, env.baseURI).href;
  }
  return `${PRODUCT_SITE}/${rel}`;
}

/** URL of a product page for THIS instance: local while developing, the
 *  canonical site once deployed. */
export function productUrl(path: string): string {
  return resolveProductUrl(path, {
    dev: import.meta.env.DEV,
    hostname: location.hostname,
    baseURI: document.baseURI,
  });
}

/** Open a product page in a new tab (never navigates the viewer away — a host
 *  may have it embedded). */
export function openProductPage(path: string): void {
  window.open(productUrl(path), '_blank', 'noopener');
}
