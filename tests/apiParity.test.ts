// The postMessage API has three descriptions that must agree: the command
// catalog in EVENTS.md, the handler table in src/lib/messageApi, and the
// commands the SDK sends. Likewise the event list (apiEvents.ts) must match
// what the viewer emits and what the SDK types. The doc generator only checks
// that documented SDK methods have an example; this pins the sets.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_EVENTS } from '../src/lib/messageApi/apiEvents';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
const API_DIR = 'src/lib/messageApi';
const NAME = /[A-Za-z][\w]*(?:\.[\w]+)+/g;

function catalogCommands(): Set<string> {
  const md = read('EVENTS.md');
  const start = md.indexOf('\n## Command catalog');
  const end = md.indexOf('\n## ', start + 1);
  const out = new Set<string>();
  for (const sec of md.slice(start, end).split(/^### /m).slice(1)) {
    for (const c of sec.slice(0, sec.indexOf('\n')).match(NAME) ?? []) {
      out.add(c);
    }
  }
  return out;
}

function handlerKeys(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(resolve(root, API_DIR)).filter((f) => /^handlers.*\.ts$/.test(f))) {
    for (const m of read(`${API_DIR}/${f}`).matchAll(/^\s*'([A-Za-z]+(?:\.[A-Za-z]+)+)':/gm)) {
      out.add(m[1]);
    }
  }
  return out;
}

function sdkCommands(): Set<string> {
  const out = new Set<string>();
  for (const m of read('api/tredespace-client.ts').matchAll(/\.(?:send|loadCall)(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g)) {
    out.add(m[1]);
  }
  return out;
}

/** Every event type the viewer posts, from the source: `emitApiEvent('…')`
 *  literals anywhere in src, the progress names handed to the SQL runners,
 *  the bus messages clients.ts posts, and the announce. */
function emittedEvents(): Set<string> {
  const out = new Set<string>(['app.ready']);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (/\.tsx?$/.test(e.name)) {
        const s = readFileSync(p, 'utf8');
        for (const m of s.matchAll(/emitApiEvent\(\s*'([^']+)'/g)) {
          out.add(m[1]);
        }
        for (const m of s.matchAll(/postToClient\([^,]+,\s*'([^']+)'/g)) {
          out.add(m[1]);
        }
        for (const m of s.matchAll(/'(sql\.[a-z]+:progress)'/g)) {
          out.add(m[1]);
        }
      }
    }
  };
  walk(resolve(root, 'src'));
  return out;
}

function sdkEventMapKeys(): Set<string> {
  const src = read('api/tredespace-client.ts');
  const start = src.indexOf('export interface TredespaceEventMap {');
  const body = src.slice(start, src.indexOf('\n}', start));
  return new Set([...body.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
}

function sdkSubscribedEvents(): Set<string> {
  const src = read('api/tredespace-client.ts');
  const out = new Set<string>();
  for (const m of src.matchAll(/\.(?:on|progressFor)(?:<[^>]*>)?\(\s*'([^']+)'/g)) {
    out.add(m[1]);
  }
  return out;
}

const missing = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).sort();
const LOCAL = ['client.closed', 'relay.changed'];

describe('postMessage API parity', () => {
  it('EVENTS.md catalog, the handler table and the SDK name the same commands', () => {
    const docs = catalogCommands();
    const handlers = handlerKeys();
    const sdk = sdkCommands();
    expect(handlers.size).toBeGreaterThan(50);
    expect(missing(docs, handlers), 'documented but no handler').toEqual([]);
    expect(missing(handlers, docs), 'handler but undocumented').toEqual([]);
    expect(missing(sdk, handlers), 'SDK sends a command with no handler').toEqual([]);
    expect(missing(handlers, sdk), 'handler the SDK cannot send').toEqual([]);
  });

  it('API_EVENTS is exactly what the viewer emits', () => {
    const emitted = emittedEvents();
    const listed = new Set<string>(API_EVENTS);
    expect(missing(emitted, listed), 'emitted but not in API_EVENTS').toEqual([]);
    expect(missing(listed, emitted), 'in API_EVENTS but never emitted').toEqual([]);
  });

  it('the SDK event map lists every API event plus its two local ones', () => {
    const expected = new Set<string>([...API_EVENTS, ...LOCAL]);
    const map = sdkEventMapKeys();
    expect(missing(expected, map), 'event missing from TredespaceEventMap').toEqual([]);
    expect(missing(map, expected), 'TredespaceEventMap names an unknown event').toEqual([]);
  });

  it('the SDK never subscribes to an event the viewer does not post', () => {
    const known = new Set<string>([...API_EVENTS, ...LOCAL]);
    expect(missing(sdkSubscribedEvents(), known)).toEqual([]);
  });

  it('every event section in EVENTS.md is a real event', () => {
    const md = read('EVENTS.md');
    const start = md.indexOf('\n## Events');
    const end = md.indexOf('\n## ', start + 1);
    const documented = new Set<string>();
    for (const sec of md.slice(start, end).split(/^### /m).slice(1)) {
      for (const c of sec.slice(0, sec.indexOf('\n')).match(NAME) ?? []) {
        documented.add(c);
      }
    }
    expect(missing(documented, new Set<string>([...API_EVENTS, ...LOCAL]))).toEqual([]);
  });
});
