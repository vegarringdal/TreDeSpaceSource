import { describe, expect, it } from 'vitest';
import { PRODUCT_SITE, resolveProductUrl } from '../src/lib/productUrl';

describe('resolveProductUrl', () => {
  it('resolves relative to the running instance in dev mode', () => {
    const url = resolveProductUrl('docs/', { dev: true, hostname: 'viewer.example.com', baseURI: 'https://viewer.example.com/app/' });
    expect(url).toBe('https://viewer.example.com/app/docs/');
  });

  it('resolves relative to the running instance on localhost, even in a prod build', () => {
    // browsers report an IPv6 hostname WITH brackets, and the URL needs them too
    for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
      const url = resolveProductUrl('docs/', { dev: false, hostname, baseURI: `http://${hostname}:2080/` });
      expect(url).toBe(`http://${hostname}:2080/docs/`);
    }
  });

  it('goes to the product site from any deployed host', () => {
    const url = resolveProductUrl('docs/', { dev: false, hostname: 'portal.customer.com', baseURI: 'https://portal.customer.com/viewer/' });
    expect(url).toBe(`${PRODUCT_SITE}/docs/`);
  });

  it('tolerates a leading slash', () => {
    expect(resolveProductUrl('/demo/', { dev: false, hostname: 'x.com', baseURI: 'https://x.com/' })).toBe(`${PRODUCT_SITE}/demo/`);
  });
});
