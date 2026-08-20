// demo.ts — the live mini-demo at the bottom of the pitch page.
//
// It embeds the real viewer (one level up, exactly like /demo does), then wires
// the toolbar buttons to real SDK calls. The viewer only loads once the demo
// scrolls into view, so the top of the pitch stays light. Opened as a bare
// file (no server) there is no viewer to reach — the status line says so and
// the buttons stay disabled.

import { TredespaceClient } from '../api/tredespace-client';
import { currentTheme, toggleTheme } from './theme';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const statusEl = $('demoStatus');
const iframe = $<HTMLIFrameElement>('demoViewer');
const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-demo-action]'));

function setStatus(msg: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
  statusEl.textContent = msg;
  statusEl.dataset.kind = kind;
}
function setEnabled(on: boolean): void {
  for (const b of buttons) {
    b.disabled = !on;
  }
}
function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
// Commands return Result{data?,error?} and never throw — unwrap to the data, or
// throw the pretty message so run()'s catch surfaces it.
function must<T>(res: { data?: T; error?: { msg: string } }): T {
  if (res.error || res.data === undefined) {
    throw new Error(res.error?.msg ?? 'no data returned');
  }
  return res.data;
}
async function run(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    setStatus(`${label}…`);
    await fn();
  } catch (e) {
    setStatus(`${label} failed — ${describe(e)}`, 'err');
  }
}

// The viewer app is served at ../ (dist root). Hand it our origin via
// ?apiOrigins= so it allowlists this page for the postMessage API.
const appUrl = `${new URL('..', location.href).href}?apiOrigins=${encodeURIComponent(location.origin)}`;
const client = new TredespaceClient(iframe, { targetOrigin: location.origin });

// The demo model: the Huldra platform sample, shipped gzipped (public/ →
// HuldraDemo.glb.gz in the build) and cooked in the viewer as a merged model.
const HULDRA_GLB = new URL('../HuldraDemo.glb', location.href).href;
// "Add label" walks these tag fullnames from the model, one per click.
const HULDRA_TAGS = [
  '/PPD-300-008-PEN0',
  '/PPD-300-016-PEN0',
  '/PPD-300-032-PEN0',
  '/PPD-300-018-PEN0',
  '/PPD-300-019-PEN0',
  '/PPD-300-034-PEN0',
  '/PPD-300-020-PEN0',
  '/PPD-300-021-PEN0',
  '/PPD-300-026-PEN0',
  '/PPD-300-027-PEN0',
];
let modelLoaded = false;
// kiosk: uiKiosk() with no arg only queries, so we track state and send the flip
let kioskOn = false;
let viewerReady = false;

/** Fetch the model bytes. Production ships only the gzipped copy — fetch it and
 *  gunzip in-browser (DecompressionStream, opaque bytes, no Content-Encoding);
 *  dev serves the raw file from public/, so fall back to that when no .gz. */
async function fetchHuldraGlb(): Promise<ArrayBuffer> {
  const gz = await fetch(`${HULDRA_GLB}.gz`);
  // guard against a dev SPA fallback answering a missing .gz with 200 + HTML
  if (gz.ok && gz.body && !gz.headers.get('content-type')?.includes('text/html')) {
    return new Response(gz.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const raw = await fetch(HULDRA_GLB);
  if (!raw.ok) {
    throw new Error(`could not fetch HuldraDemo.glb (${raw.status})`);
  }
  return raw.arrayBuffer();
}

setEnabled(false);
setStatus('Scroll down to load the viewer…');

// ── lazy start: only boot the viewer when the demo is near the viewport ──
let started = false;
function start(): void {
  if (started) {
    return;
  }
  started = true;
  setStatus('Connecting to the viewer…');
  iframe.src = appUrl;
  client
    .ready()
    .then(async (info) => {
      viewerReady = true;
      // start in kiosk — panels hidden, viewport only (this is an embed)
      const k = await client.uiKiosk(true);
      kioskOn = k.data?.kiosk ?? true;
      $('btnKiosk').setAttribute('aria-pressed', String(kioskOn));
      // match the viewer to the docs page theme on connect
      void client.uiTheme(currentTheme());
      setEnabled(true);
      setStatus(`Viewer ready — v${info.version}. Start with “Add model”.`, 'ok');
    })
    .catch(() =>
      setStatus(
        'Viewer not reachable — open this page from the running app (npm run dev / preview), not as a bare file.',
        'err',
      ),
    );
}

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        start();
      }
    },
    { rootMargin: '250px' },
  );
  io.observe($('demo'));
} else {
  start();
}

// ── button wiring ──
$('btnAddModel').onclick = () =>
  run('Loading the Huldra model', async () => {
    setStatus('Downloading Huldra…');
    const bytes = await fetchHuldraGlb();
    setStatus('Cooking Huldra in the viewer…');
    const data = must(
      await client.assetsImportAndLoad({
        fileName: 'HuldraDemo.glb',
        format: 'glb-merged',
        bytes,
        store: 'main',
        replace: true,
        fit: true,
        options: { edges: true },
      }),
    );
    modelLoaded = true;
    setStatus(
      `Huldra loaded (${data.entries.length} asset, ${(bytes.byteLength / 1e6).toFixed(1)} MB). Try Add label.`,
      'ok',
    );
  });

$('btnAddLabel').onclick = () =>
  run('Adding labels', async () => {
    if (!modelLoaded) {
      setStatus('Add the model first.', 'err');
      return;
    }
    // one click drops a label on every tag — anchored by fullname (the viewer
    // resolves each to the item's bounds centre); text is the tag sans slash
    const data = must(
      await client.labelsAdd(HULDRA_TAGS.map((fullname) => ({ text: fullname.replace(/^\//, ''), fullname }))),
    );
    const miss = data.missed.length ? `, ${data.missed.length} not found in the model` : '';
    setStatus(`${data.added} label(s) added${miss}. Try Explode / Implode.`, data.missed.length ? 'err' : 'ok');
  });

$('btnRemoveLabels').onclick = () =>
  run('Clearing labels', async () => {
    must(await client.labelsClear());
    setStatus('Labels cleared.', 'ok');
  });

$('btnExplode').onclick = () =>
  run('Exploding labels', async () => {
    must(await client.labelsExplode());
    setStatus('Labels exploded — spread out from their anchors.', 'ok');
  });

$('btnImplode').onclick = () =>
  run('Imploding labels', async () => {
    must(await client.labelsImplode());
    setStatus('Labels imploded — pulled back to their anchors.', 'ok');
  });

$('btnSketch').onclick = () =>
  run('Toggling sketch mode', async () => {
    const { sketch } = must(await client.viewSketch());
    $('btnSketch').setAttribute('aria-pressed', String(sketch));
    setStatus(`Sketch mode ${sketch ? 'on' : 'off'}.`, 'ok');
  });

$('btnKiosk').onclick = () =>
  run('Toggling kiosk mode', async () => {
    const { kiosk } = must(await client.uiKiosk(!kioskOn));
    kioskOn = kiosk;
    $('btnKiosk').setAttribute('aria-pressed', String(kiosk));
    setStatus(`Kiosk mode ${kiosk ? 'on — panels hidden, viewport only' : 'off'}.`, 'ok');
  });

$('btnScreenshot').onclick = () =>
  run('Taking a screenshot', async () => {
    const { dataUrl, width, height } = must(await client.viewScreenshot());
    // the viewer hands back a PNG data URL — download it from the host
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'tredespace-demo.png';
    a.click();
    setStatus(`Screenshot captured (${width}×${height}) and downloaded.`, 'ok');
  });

// ── theme: one source of truth is the docs page's data-theme. Our button flips
// it (like the top-bar toggle); the observer mirrors any change into the viewer,
// so the embedded viewer follows the page's light/dark mode by default. ──
const reflectThemeButton = () => {
  $('btnThemeState').textContent = currentTheme();
};
$('btnTheme').onclick = () => {
  toggleTheme(); // flips the page; the observer below pushes it to the viewer
  reflectThemeButton();
};
reflectThemeButton();
new MutationObserver(() => {
  reflectThemeButton();
  if (viewerReady) {
    void client.uiTheme(currentTheme());
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
