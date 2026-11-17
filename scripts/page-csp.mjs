// The Content-Security-Policy of every page the build emits — the viewer,
// /docs/ (product page, API reference, widget gallery, user guide) and /demo/.
// They share one origin, and same-origin pages are API-trusted, so each one
// carries it. vite.config.ts writes it into every page as a meta tag (which
// also covers hosts that cannot set headers, like GitHub Pages), and the
// container's nginx sends it as a header (docker/csp-header.conf —
// tests/securityHeaders.test.ts keeps the two equal). DESIGN.md › "Untrusted
// input & CSP" says what it does and deliberately leaves open.
export const PAGE_CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'self'";
