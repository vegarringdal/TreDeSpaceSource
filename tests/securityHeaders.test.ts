// The container's security headers and the CI hardening stay as designed
// (DESIGN.md › "Untrusted input & CSP", CONTRIBUTING.md › Container images):
// nginx sends the same CSP the build writes into every page, every location
// carries the headers, actions stay pinned and no expression is spliced into
// a shell script.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_CSP } from '../scripts/page-csp.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const SNIPPETS = '/etc/nginx/snippets/';
const HEADERS = 'security-headers.conf';
const CSP = 'csp-header.conf';

/** `location <match> { … }` blocks of nginx.conf: match → body. */
function locations(conf: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of conf.matchAll(/location\s+([^{]+?)\s*\{([^}]*)\}/g)) {
    out.set(m[1].trim(), m[2]);
  }
  return out;
}

/** Lines of `run:` scripts in a workflow (block or single-line). */
function runScriptLines(yml: string): string[] {
  const lines = yml.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) {
      continue;
    }
    if (m[2] && !m[2].startsWith('|') && !m[2].startsWith('>')) {
      out.push(m[2]);
      continue;
    }
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() !== '' && l.search(/\S/) <= indent) {
        break;
      }
      out.push(l);
    }
  }
  return out;
}

describe('container security headers', () => {
  const conf = read('docker/nginx.conf');
  const locs = locations(conf);

  it('nginx sends the CSP the build writes into every page', () => {
    const value = /add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;/.exec(read(`docker/${CSP}`))?.[1];
    expect(value).toBe(PAGE_CSP);
  });

  it('every location includes the security headers, the page locations the CSP too', () => {
    expect(locs.size).toBeGreaterThan(0);
    for (const [match, body] of locs) {
      expect(body, `location ${match}`).toContain(`include ${SNIPPETS}${HEADERS};`);
    }
    for (const page of ['= /index.html', '/']) {
      expect(locs.get(page), `location ${page}`).toContain(`include ${SNIPPETS}${CSP};`);
    }
  });

  it('the headers are nosniff and a referrer policy that still sends the origin', () => {
    const headers = read(`docker/${HEADERS}`);
    expect(headers).toMatch(/add_header\s+X-Content-Type-Options\s+"nosniff"\s+always;/);
    // a viewer-opened External app tab reads the viewer's origin from
    // document.referrer (EVENTS.md): no-referrer / same-origin would break it
    expect(headers).toMatch(/add_header\s+Referrer-Policy\s+"strict-origin-when-cross-origin"\s+always;/);
  });

  it('the image copies both snippets to where nginx includes them', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(new RegExp(`COPY [^\\n]*docker/${HEADERS}[^\\n]*docker/${CSP}\\s+${SNIPPETS}`));
  });

  it('base images are pinned by digest', () => {
    const froms = [...read('Dockerfile').matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(0);
    for (const image of froms) {
      expect(image, image).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
  });
});

describe('workflow hardening', () => {
  const dir = resolve(root, '.github/workflows');
  const workflows = readdirSync(dir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => ({ f, yml: readFileSync(resolve(dir, f), 'utf8') }));

  it('every action is pinned to a commit SHA', () => {
    for (const { f, yml } of workflows) {
      for (const m of yml.matchAll(/uses:\s*(\S+)/g)) {
        if (m[1].startsWith('./')) {
          continue;
        }
        expect(m[1], `${f}: ${m[1]}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it('no ${{ }} expression is spliced into a run script — values arrive through env', () => {
    for (const { f, yml } of workflows) {
      for (const line of runScriptLines(yml)) {
        expect(line, `${f}: ${line.trim()}`).not.toContain('${{');
      }
    }
  });
});
