// events.ts — render the API command reference from the build-generated
// apiData.json (derived from the SDK, so it can't drift), and wire the SDK
// download. The stable narrative (envelope, handshake, security) is authored in
// events.html; only the per-command detail and the type shapes are generated.

import clientSrc from '../api/tredespace-client.ts?raw';
import data from './generated/apiData.json';

interface MethodDoc {
  name: string;
  command: string | null;
  signature: string;
  doc: string;
  example: string | null;
  sample: string | null;
}
interface Group {
  ns: string;
  methods: MethodDoc[];
}
interface TypeDoc {
  name: string;
  kind?: 'interface' | 'alias';
  doc: string;
  fields?: { text: string; doc: string }[];
  def?: string;
}
interface ApiData {
  protocol: string | null;
  generatedFrom: string;
  methodCount: number;
  groups: Group[];
  types: TypeDoc[];
}

const api = data as ApiData;
const $ = (id: string) => document.getElementById(id);

// known types → clickable links (TYPE_NAMES, read by highlight()) + popup lookup
const TYPE_NAMES = new Set<string>();
const TYPES = new Map(api.types.map((t) => [t.name, t]));
for (const t of api.types) {
  TYPE_NAMES.add(t.name);
}

/** Render a type: an alias as `type X = …`, an interface as a real TS block
 *  (field docs as JSDoc comments). */
function typeBlock(t: TypeDoc): string {
  if (t.kind === 'alias' || !t.fields) {
    return `type ${t.name} = ${t.def ?? 'unknown'};`;
  }
  const lines = [`interface ${t.name} {`];
  for (const f of t.fields) {
    if (f.doc) {
      lines.push(`  /** ${f.doc.replace(/\s+/g, ' ').trim()} */`);
    }
    lines.push(`  ${f.text.replace(/;\s*$/, '')};`);
  }
  lines.push('}');
  return lines.join('\n');
}

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

// tiny inline markup for JSDoc bodies: `code` spans and {@link Name} references
function docHtml(doc: string): string {
  return esc(doc)
    .replace(/\{@link\s+([^}]+)\}/g, (_m, name) => `<code>${esc(String(name).trim())}</code>`)
    .replace(/`([^`]+)`/g, (_m, code) => `<code>${esc(String(code))}</code>`)
    .replace(/\n/g, ' ');
}

// ── lightweight TS/JS highlighter (no dependency) for signatures & examples ──
const KEYWORDS = new Set([
  'string',
  'number',
  'boolean',
  'void',
  'null',
  'undefined',
  'unknown',
  'any',
  'never',
  'readonly',
  'true',
  'false',
  'object',
  'symbol',
  'bigint',
  'interface',
  'type',
  'extends',
  // JS keywords used in the call-form samples
  'const',
  'await',
  'new',
  'return',
  'import',
  'from',
  'if',
  'else',
]);
const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\s])/g;

function highlight(code: string, firstIsFn = false): string {
  let out = '';
  let firstIdentDone = false;
  code.replace(TOKEN, (_m, cm, str, num, id, ws, other) => {
    if (cm) {
      out += `<span class="hl-cm">${esc(cm)}</span>`;
    } else if (str) {
      out += `<span class="hl-st">${esc(str)}</span>`;
    } else if (num) {
      out += `<span class="hl-nu">${esc(num)}</span>`;
    } else if (id) {
      if (firstIsFn && !firstIdentDone) {
        out += `<span class="hl-fn">${esc(id)}</span>`;
      } else if (KEYWORDS.has(id)) {
        out += `<span class="hl-kw">${esc(id)}</span>`;
      } else if (/^[A-Z]/.test(id) && TYPE_NAMES.has(id)) {
        out += `<button type="button" class="hl-ty type-link" data-type="${esc(id)}">${esc(id)}</button>`;
      } else if (/^[A-Z]/.test(id)) {
        out += `<span class="hl-ty">${esc(id)}</span>`;
      } else {
        out += esc(id);
      }
      firstIdentDone = true;
    } else if (ws) {
      out += ws;
    } else {
      out += esc(other);
    }
    return '';
  });
  return out;
}

// ── header meta ──
const meta = $('genMeta');
if (meta) {
  meta.textContent = `generated from ${api.generatedFrom} · ${api.methodCount} commands · protocol v${api.protocol}`;
}

// ── namespace jump nav ──
const nav = $('refNav');
if (nav) {
  for (const g of api.groups) {
    const a = document.createElement('a');
    a.className = 'ref-pill';
    a.href = `#ns-${g.ns}`;
    a.textContent = g.ns;
    nav.appendChild(a);
  }
}

// ── command reference ──
const ref = $('apiRef');
if (ref) {
  ref.innerHTML = '';
  for (const g of api.groups) {
    const section = document.createElement('div');
    section.className = 'ref-group';
    section.id = `ns-${g.ns}`;

    const h = document.createElement('h3');
    h.innerHTML = `${esc(g.ns)} <span class="ref-count">${g.methods.length}</span>`;
    section.appendChild(h);

    for (const m of g.methods) {
      const item = document.createElement('article');
      item.className = 'ref-item';
      item.dataset.search =
        `${m.command ?? ''} ${m.name} ${m.signature} ${m.doc} ${m.sample ?? m.example ?? ''}`.toLowerCase();
      const cmd = m.command
        ? `<span class="ref-cmd">${esc(m.command)}</span>`
        : `<span class="ref-cmd ref-cmd-none">client</span>`;
      const sample = m.sample ?? m.example;
      item.innerHTML =
        `<div class="ref-head">${cmd}<code class="ref-method">${esc(m.name)}</code></div>` +
        `<pre class="ref-sig">${highlight(m.signature, true)}</pre>` +
        (m.doc ? `<p class="ref-doc">${docHtml(m.doc)}</p>` : '') +
        (sample
          ? `<div class="ref-example"><span class="ref-example-label">example</span><pre>${highlight(sample, false)}</pre></div>`
          : '');
      section.appendChild(item);
    }
    ref.appendChild(section);
  }
}

// ── types appendix (each rendered as a real TS interface block) ──
const typesEl = $('apiTypes');
if (typesEl) {
  for (const t of api.types) {
    const card = document.createElement('article');
    card.className = 'type-card';
    card.id = `type-${t.name}`;
    const body = t.fields ? t.fields.map((f) => f.text).join(' ') : (t.def ?? '');
    card.dataset.search = `${t.name} ${t.doc} ${body}`.toLowerCase();
    card.innerHTML =
      (t.doc ? `<p class="type-doc">${docHtml(t.doc)}</p>` : '') +
      `<pre class="type-sig">${highlight(typeBlock(t))}</pre>`;
    typesEl.appendChild(card);
  }
}

// ── filter ──
const search = $('refSearch') as HTMLInputElement | null;
search?.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  for (const item of document.querySelectorAll<HTMLElement>('.ref-item')) {
    item.style.display = !q || (item.dataset.search ?? '').includes(q) ? '' : 'none';
  }
  // hide a namespace group whose items are all filtered out
  for (const group of document.querySelectorAll<HTMLElement>('.ref-group')) {
    const anyVisible = [...group.querySelectorAll<HTMLElement>('.ref-item')].some((i) => i.style.display !== 'none');
    group.style.display = anyVisible ? '' : 'none';
  }
  for (const t of document.querySelectorAll<HTMLElement>('.type-card')) {
    t.style.display = !q || (t.dataset.search ?? '').includes(q) ? '' : 'none';
  }
});

// ── SDK download (works in dev and build; always the current source) ──
const blobUrl = URL.createObjectURL(new Blob([clientSrc], { type: 'text/plain;charset=utf-8' }));
$('downloadSdk')?.addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = 'tredespace-client.ts';
  document.body.appendChild(a);
  a.click();
  a.remove();
});
// In dev the emitted /docs/tredespace-client.ts file doesn't exist yet — point
// "View raw" at the in-memory copy so it still works. In build, keep the static
// file URL (cacheable, curl-able).
const raw = $('rawSdkLink') as HTMLAnchorElement | null;
if (raw && import.meta.env.DEV) {
  raw.href = blobUrl;
  raw.removeAttribute('download');
  raw.target = '_blank';
}

// ── click a type name (in any signature/example/type block) → popup ──
const pop = document.createElement('div');
pop.className = 'type-pop';
pop.hidden = true;
document.body.appendChild(pop);

document.addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const link = el.closest('.type-link') as HTMLElement | null;
  if (link?.dataset.type) {
    const t = TYPES.get(link.dataset.type);
    if (!t) {
      return;
    }
    pop.innerHTML =
      `<div class="type-pop-title">${esc(t.name)}</div>` +
      (t.doc ? `<p class="type-pop-doc">${docHtml(t.doc)}</p>` : '') +
      `<pre>${highlight(typeBlock(t))}</pre>`;
    pop.hidden = false;
    const r = link.getBoundingClientRect();
    const w = Math.min(400, window.innerWidth - 16);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - w - 8))}px`;
    pop.style.top = `${window.scrollY + r.bottom + 6}px`;
    e.stopPropagation();
  } else if (!el.closest('.type-pop')) {
    pop.hidden = true;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    pop.hidden = true;
  }
});
