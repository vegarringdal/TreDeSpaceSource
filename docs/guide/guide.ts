// guide.ts — renders the generated parts of every user-guide page
// (docs/guide/*.html). The prose lives in the HTML; the screenshots, their
// numbered-marker boxes and the per-panel control reference come from
// scripts/doc-shots.mjs (docs/guide/img/*.webp + docs/guide/data/*.json), so
// re-running that script refreshes every picture and table without touching
// the text. Also builds the sidebar: the guide's page list + this page's
// contents.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Badge corner of a marker box: top-left unless the scene moved it. */
type MarkCorner = 'tr' | 'bl' | 'br';

type Mark = Readonly<{ n: number; x: number; y: number; w: number; h: number; at?: string }>;

type Shot = Readonly<{ w: number; h: number; gpu: boolean; marks: readonly Mark[] }>;

type RefRow = Readonly<{ section: string; label: string; icon: string; tooltip: string; keys: string }>;

type ShotData = Readonly<{
  shots: Readonly<Record<string, Shot>>;
  reference: Readonly<Record<string, readonly RefRow[]>>;
  appVersion?: string;
}>;

type GuidePage = Readonly<{ href: string; title: string; key?: string }>;

type GuideGroup = Readonly<{ title: string; pages: readonly GuidePage[] }>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** One data file per scene (doc-shots.mjs), merged — shot ids are unique across scenes. */
const DATA_FILES = Object.values(import.meta.glob<ShotData>('./data/*.json', { eager: true, import: 'default' }));

const SHOTS: Readonly<Record<string, Shot>> = Object.assign({}, ...DATA_FILES.map((d) => d.shots));

const REFERENCE: Readonly<Record<string, readonly RefRow[]>> = Object.assign({}, ...DATA_FILES.map((d) => d.reference));

const APP_VERSION =
  DATA_FILES.map((d) => d.appVersion ?? '')
    .sort()
    .at(-1) ?? '';

/** Image URL per shot id — Vite fingerprints and copies only what exists. */
const IMAGES = Object.fromEntries(
  Object.entries(import.meta.glob<string>('./img/*.webp', { eager: true, query: '?url', import: 'default' })).map(
    ([path, url]) => [path.replace(/^.*\/(.+)\.webp$/, '$1'), url],
  ),
);

const SHOTS_COMMAND = 'npm run docs:shots -- --browser-url <a GPU Chrome> (see docs/README.md)';

/** The guide's page list (sidebar). Add a page here when it is created. */
const GUIDE: readonly GuideGroup[] = [
  { title: 'Start', pages: [{ href: 'index.html', title: 'Overview & app layouts' }] },
  {
    title: 'App layouts',
    pages: [
      { href: 'f01-home.html', title: 'Home', key: 'F1' },
      { href: 'f02-clip-plane.html', title: 'Clip Plane', key: 'F2' },
      { href: 'f03-clip-box.html', title: 'Clip Box', key: 'F3' },
      { href: 'f04-selection-color.html', title: 'Selection Color', key: 'F4' },
      { href: 'f05-transform.html', title: 'Transform', key: 'F5' },
      { href: 'f06-measurements.html', title: 'Measurements', key: 'F6' },
      { href: 'f07-external.html', title: 'External', key: 'F7' },
      { href: 'f08-panels.html', title: 'Panels', key: 'F8' },
      { href: 'f09-pad.html', title: 'Pad', key: 'F9' },
      { href: 'f10-viewpoint.html', title: 'Viewpoint', key: 'F10' },
      { href: 'f11-sql-editor.html', title: 'SQL Editor', key: 'F11' },
      { href: 'f12-assets.html', title: 'Assets', key: 'F12' },
    ],
  },
  {
    title: 'Panels',
    pages: [
      { href: 'panel-set-color.html', title: 'Set Color' },
      { href: 'panel-label.html', title: 'Label' },
      { href: 'panel-measurements.html', title: 'Measurement List' },
      { href: 'panel-settings.html', title: 'Settings' },
    ],
  },
];

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text != null) {
    node.textContent = text;
  }
  return node;
}

const pct = (v: number, of: number): string => `${((v / of) * 100).toFixed(3)}%`;

const isCorner = (v: string | undefined): v is MarkCorner => v === 'tr' || v === 'bl' || v === 'br';

/** The image + marker overlay for one shot; marker boxes are stored in CSS px
 *  of the capture, so they scale with the picture as percentages. */
function buildFrame(id: string, shot: Shot, url: string): HTMLElement {
  const frame = el('div', 'shot-frame');
  frame.style.setProperty('--w', `${shot.w}px`);
  const img = el('img');
  img.src = url;
  img.alt = `Screenshot: ${id.replace(/-/g, ' ')}`;
  img.loading = 'lazy';
  img.width = shot.w;
  img.height = shot.h;
  frame.append(img);
  for (const m of shot.marks) {
    const box = el('span', isCorner(m.at) ? `shot-mark at-${m.at}` : 'shot-mark');
    box.style.left = pct(m.x, shot.w);
    box.style.top = pct(m.y, shot.h);
    box.style.width = pct(m.w, shot.w);
    box.style.height = pct(m.h, shot.h);
    box.append(el('span', 'mk', String(m.n)));
    frame.append(box);
  }
  return frame;
}

/** Placeholder for a viewport shot that has not been captured on a GPU yet. */
function buildPending(id: string): HTMLElement {
  const box = el('div', 'shot-pending');
  box.append(el('strong', '', '3D view picture not captured yet'));
  box.append(el('span', '', `"${id}" needs a browser with a real GPU — run: ${SHOTS_COMMAND}`));
  return box;
}

function renderFigures(): void {
  for (const fig of document.querySelectorAll<HTMLElement>('figure.shot[data-shot]')) {
    const id = fig.dataset.shot ?? '';
    const shot = SHOTS[id];
    const url = IMAGES[id];
    const body = shot && url ? buildFrame(id, shot, url) : buildPending(id);
    if (shot?.gpu) {
      fig.classList.add('is-viewport');
    }
    fig.prepend(body);
  }
}

/** Plain thumbnails (layout cards): the picture only, no markers, no lightbox. */
function renderThumbs(): void {
  for (const host of document.querySelectorAll<HTMLElement>('[data-thumb]')) {
    const url = IMAGES[host.dataset.thumb ?? ''];
    if (!url) {
      continue;
    }
    const img = host.appendChild(el('img'));
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
  }
}

function renderReference(): void {
  for (const host of document.querySelectorAll<HTMLElement>('.ref-table[data-ref]')) {
    const rows = REFERENCE[host.dataset.ref ?? ''] ?? [];
    const table = el('table');
    const head = el('tr');
    for (const h of ['Control', 'What it does', 'Shortcut']) {
      head.append(el('th', '', h));
    }
    table.appendChild(el('thead')).append(head);
    const body = table.appendChild(el('tbody'));
    let section: string | null = null;
    for (const r of rows) {
      if (r.section !== section) {
        section = r.section;
        const tr = body.appendChild(el('tr', 'ref-section'));
        const th = tr.appendChild(el('th', '', section));
        th.colSpan = 3;
      }
      const tr = body.appendChild(el('tr'));
      const name = tr.appendChild(el('td', 'ref-name'));
      if (r.icon) {
        // icons are the app's own Tabler SVGs, harvested by doc-shots.mjs
        name.appendChild(el('span', 'ref-icon')).innerHTML = r.icon;
      }
      name.append(r.label);
      tr.append(el('td', '', r.tooltip));
      const keys = tr.appendChild(el('td', 'ref-keys'));
      if (r.keys) {
        keys.append(el('kbd', '', r.keys));
      }
    }
    host.append(table);
  }
}

function renderGuideNav(): void {
  const nav = document.getElementById('guideNav');
  if (!nav) {
    return;
  }
  const here = location.pathname.split('/').pop() || 'index.html';
  for (const group of GUIDE) {
    const box = nav.appendChild(el('div', 'toc-group'));
    box.append(el('span', 'toc-label', group.title));
    for (const page of group.pages) {
      const link = box.appendChild(el('a', page.href === here ? 'toc-page is-current' : 'toc-page'));
      link.href = page.href;
      if (page.key) {
        link.append(el('kbd', 'toc-key', page.key));
      }
      link.append(page.title);
    }
  }
}

function renderToc(): void {
  const toc = document.getElementById('toc');
  if (!toc) {
    return;
  }
  for (const sec of document.querySelectorAll<HTMLElement>('.g-sec')) {
    const h2 = sec.querySelector('h2');
    const group = toc.appendChild(el('div', 'toc-group'));
    const top = group.appendChild(el('a', 'toc-h2', h2?.textContent ?? ''));
    top.href = `#${sec.id}`;
    for (const h3 of sec.querySelectorAll<HTMLElement>('h3[id]')) {
      const link = group.appendChild(el('a', 'toc-h3', h3.textContent ?? ''));
      link.href = `#${h3.id}`;
    }
  }
}

// -----------------------------------------------------------------------------
// Event handlers
// -----------------------------------------------------------------------------

function handleFrameClick(e: MouseEvent): void {
  const target = e.target;
  if (!(target instanceof Element)) {
    return;
  }
  const frame = target.closest('.guide-main .shot-frame');
  const dialog = document.getElementById('lightbox');
  if (!frame || !(dialog instanceof HTMLDialogElement)) {
    return;
  }

  const body = dialog.querySelector('.lightbox-body');
  body?.replaceChildren(frame.cloneNode(true));
  dialog.showModal();
}

function handleLightboxClick(e: MouseEvent): void {
  const dialog = e.currentTarget;
  if (!(dialog instanceof HTMLDialogElement)) {
    return;
  }
  const isBackdrop = e.target === dialog;
  const isClose = e.target instanceof Element && e.target.closest('.lightbox-close');
  if (isBackdrop || isClose) {
    dialog.close();
  }
}

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

renderFigures();
renderThumbs();
renderReference();
renderGuideNav();
renderToc();
document.addEventListener('click', handleFrameClick);
document.getElementById('lightbox')?.addEventListener('click', handleLightboxClick);
const version = document.getElementById('guideVersion');
if (version && APP_VERSION) {
  version.textContent = `Screenshots from version ${APP_VERSION}`;
}
