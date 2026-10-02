// User-guide screenshot runner: drives the REAL app through every scene in
// docs/guide/scenes/*.mjs (files starting with "_" are helpers) and writes
// docs/guide/img/<shot>.webp plus docs/guide/data/<scene>.json (crop size,
// numbered-marker boxes, harvested panel reference). Re-run it whenever a
// documented panel changes — the guide pages only read these committed
// outputs, so the build never needs a browser. Concurrent runs queue on a
// lock file, so several can be started at once.
//
//   npm run docs:shots                         headless, UI shots only
//   npm run docs:shots -- --only setColor      one scene
//   npm run docs:shots -- --browser-url http://127.0.0.1:9222 [--app-url URL]
//
// Headless Chrome has no real GPU, so the 3D viewport comes out blank: shots
// marked `gpu: true` are SKIPPED headless (their previous image is kept). To
// capture them, start a SEPARATE Chrome/Chromium with a real GPU, e.g.
//   chromium --user-data-dir=$HOME/.cache/docshots-profile \
//            --remote-debugging-port=9222 --enable-unsafe-webgpu \
//            --enable-webgpu-developer-features --enable-features=Vulkan
// and pass --browser-url: every shot (UI + viewport) is then taken there, in a
// fresh incognito context. Chrome >= 136 ignores the port on the default
// profile (hence --user-data-dir), and that fresh profile has none of your
// chrome://flags, so the WebGPU switches must be on the command line. The
// chrome://inspect "Allow remote debugging" toggle does NOT work here: it
// serves no /json/version, so puppeteer cannot discover the browser.
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'docs/guide/img');
const SCENE_DIR = resolve(ROOT, 'docs/guide/scenes');
const DATA_DIR = resolve(ROOT, 'docs/guide/data');
const LOCK_DIR = resolve(tmpdir(), 'tredespace-doc-shots.lock');
const LOCK_POLL_MS = 2000;
const PORT = 5197;
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };
const WEBP_QUALITY = 90;
const BOOT_SETTLE_MS = 2500;
const UI_SETTLE_MS = 350;
const GPU_SETTLE_MS = 2500;

const { values: opts } = parseArgs({
  options: {
    only: { type: 'string' },
    'browser-url': { type: 'string' },
    'app-url': { type: 'string' },
  },
});
const hasGpu = Boolean(opts['browser-url']);
const only = opts.only ? new Set(opts.only.split(',')) : null;

// -----------------------------------------------------------------------------
// in-page helpers (installed before the app boots)
// -----------------------------------------------------------------------------

/** Resolves an element spec inside the page: { panel | within, section,
 *  tooltip | text | re | css, nth }. `within` is a CSS root (e.g. an open
 *  listbox); `section` narrows to a Collapsible (header title prefix) or a
 *  ribbon group (title-strip prefix);
 *  `text` / `re` match the trimmed text of the innermost element, then climb
 *  to the nearest button/label so the box covers the whole control. Only one
 *  matcher applies (css > tooltip > text/re) — to find text inside a CSS
 *  root, pass the root as `within`. */
function installPageHelpers() {
  /** A Collapsible by its header title, else a ribbon group by its title strip. */
  const sectionOf = (root, title) => {
    for (const btn of root.querySelectorAll('button[aria-expanded]')) {
      if (btn.textContent.trim().startsWith(title)) {
        return btn.parentElement.parentElement;
      }
    }
    for (const strip of root.querySelectorAll('.text-center.font-semibold')) {
      if (strip.textContent.trim().startsWith(title) && strip.parentElement.childElementCount === 2) {
        return strip.parentElement;
      }
    }
    return null;
  };
  const find = (spec) => {
    let root = document;
    if (spec.panel) {
      root = document.querySelector(`.dock-panel[data-panel="${spec.panel}"]`);
    } else if (spec.within) {
      root = document.querySelector(spec.within);
    }
    if (root && spec.section) {
      root = sectionOf(root, spec.section);
    }
    if (!root) {
      return null;
    }
    let hits = [];
    if (spec.css) {
      hits = [...root.querySelectorAll(spec.css)];
    } else if (spec.tooltip) {
      hits = [...root.querySelectorAll('[data-tooltip]')].filter((e) => e.dataset.tooltip.startsWith(spec.tooltip));
    } else if (spec.text || spec.re) {
      const re = spec.re ? new RegExp(spec.re) : null;
      const all = [...root.querySelectorAll('*')].filter((e) =>
        re ? re.test(e.textContent.trim()) : e.textContent.trim() === spec.text,
      );
      hits = all
        .filter((e) => !all.some((o) => o !== e && e.contains(o)))
        .map((e) => e.closest('button,label,[role="tab"],[role="option"]') ?? e);
    } else if (spec.panel || spec.within || spec.section) {
      hits = [root];
    }
    return hits[spec.nth ?? 0] ?? null;
  };
  const rectOf = (spec) => {
    const el = find(spec);
    if (!el) {
      return null;
    }
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  /** The dock stack (tab header + body) that hosts panel `id`; `fit` trims
   *  the empty body below the last visible control. */
  const panelFrame = (id, fit = false) => {
    const el = document.querySelector(`.dock-panel[data-panel="${id}"]`);
    const r = (el?.closest('section.dock-tabs') ?? el)?.getBoundingClientRect();
    if (!r) {
      return null;
    }
    let bottom = r.bottom;
    if (fit) {
      const leaves = [...el.querySelectorAll('*')].filter((e) => e.childElementCount === 0 || e.matches('button,input,textarea'));
      const edges = leaves.map((e) => e.getBoundingClientRect()).filter((b) => b.height > 0);
      bottom = Math.min(r.bottom, Math.max(...edges.map((b) => b.bottom)) + 12);
    }
    return { x: r.left, y: r.top, w: r.width, h: bottom - r.top };
  };
  /** Centre of the vertical splitter on the left edge of panel `id`'s stack. */
  const leftSplitter = (id) => {
    const stack = document.querySelector(`.dock-panel[data-panel="${id}"]`)?.closest('section.dock-tabs');
    const r = stack?.getBoundingClientRect();
    if (!r) {
      return null;
    }
    for (const sp of document.querySelectorAll('.dock-splitter')) {
      const b = sp.getBoundingClientRect();
      if (b.height > b.width && Math.abs(b.right - r.left) < 8 && b.top <= r.top + 1 && b.bottom >= r.bottom - 1) {
        return { x: b.left + b.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  };
  window.__doc = { find, rectOf, panelFrame, leftSplitter, sectionOf };
}

// -----------------------------------------------------------------------------
// scene context — the API scenes.mjs drives
// -----------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeContext(page, data, seen) {
  const ctx = {
    page,
    hasGpu,

    /** Call an app module export from the page: ctx.call('/src/x.ts', 'obj', 'method', ...args). */
    async call(modulePath, exportName, method, ...args) {
      return page.evaluate(
        async (p, e, m, a) => {
          const mod = await import(p);
          const target = m ? mod[e][m].bind(mod[e]) : mod[e];
          return await target(...a);
        },
        modulePath,
        exportName,
        method,
        args,
      );
    },

    /** Run a function in the page (page.evaluate pass-through). */
    async eval(fn, ...args) {
      return page.evaluate(fn, ...args);
    },

    /** Import Huldra sample RVMs (convertSamples/rvm/<name>.RVM) into one folder and fit the view. */
    async loadSamples(names, folder = 'Huldra') {
      // read the asset library first, as the Import Manager and the host API do:
      // its first read purges "temp" entries as leftovers of an earlier session,
      // which would take these imports with it when Model Assets opens later
      await page.evaluate(async () => {
        await (await import('/src/state/stores/stores.actions.ts')).storesActions.init();
        await (await import('/src/state/assets/assets.actions.ts')).assetsActions.init();
      });
      for (const name of names) {
        await page.evaluate(
          async (n, f) => {
            const { assetsActions } = await import('/src/state/assets/assets.actions.ts');
            const bytes = await (await fetch(`/convertSamples/rvm/${n}.RVM`)).arrayBuffer();
            await assetsActions.importRvm(new File([bytes], `${n}.RVM`), { folder: f, load: true, temp: true, quiet: true });
          },
          name,
          folder,
        );
      }
      await ctx.call('/src/state/viewer/viewer.actions.ts', 'viewerActions', 'fitVisible', { wait: hasGpu });
      await sleep(UI_SETTLE_MS);
    },

    /** Show panel `id` and bring its tab to the front. */
    async open(id) {
      const isMounted = await page.evaluate((i) => !!document.querySelector(`.dock-tab[data-tab="${i}"]`), id);
      if (!isMounted) {
        await ctx.call('/src/components/panels/ribbon-panels/panelToggle.ts', 'togglePanelById', null, id);
        await sleep(UI_SETTLE_MS);
      }
      // a real click (down + up): a bare pointerdown starts a tab drag
      await (await ctx.handle({ css: `.dock-tab[data-tab="${id}"]` })).click();
      await page.mouse.move(1, 1);
      await sleep(UI_SETTLE_MS);
    },

    /** Drag the splitter left of panel `id`'s stack so the stack is `width` px wide. */
    async widen(id, width) {
      const at = await page.evaluate((i) => window.__doc.leftSplitter(i), id);
      const frame = await page.evaluate((i) => window.__doc.panelFrame(i), id);
      if (!at || !frame) {
        throw new Error(`docs-shots: no splitter left of ${id}`);
      }
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x - (width - frame.w), at.y, { steps: 8 });
      await page.mouse.up();
      await page.mouse.move(1, 1);
      await sleep(UI_SETTLE_MS);
    },

    async close(id) {
      const isMounted = await page.evaluate((i) => !!document.querySelector(`.dock-tab[data-tab="${i}"]`), id);
      if (isMounted) {
        await ctx.call('/src/components/panels/ribbon-panels/panelToggle.ts', 'togglePanelById', null, id);
        await sleep(UI_SETTLE_MS);
      }
    },

    async handle(spec) {
      const h = await page.evaluateHandle((s) => window.__doc.find(s), spec);
      const el = h.asElement();
      if (!el) {
        throw new Error(`docs-shots: element not found ${JSON.stringify(spec)}`);
      }
      return el;
    },

    async click(spec) {
      await (await ctx.handle(spec)).click();
      await sleep(UI_SETTLE_MS);
    },

    /** Replace the text of an input/textarea the way a user would (select all, type). */
    async type(spec, text) {
      const el = await ctx.handle(spec);
      await el.click({ count: 3 });
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await el.type(text);
      await sleep(UI_SETTLE_MS);
    },

    /** Open (or close) a Collapsible section of a panel by its title prefix. */
    async section(panel, title, isOpen = true) {
      await page.evaluate(
        (p, t, o) => {
          const root = document.querySelector(`.dock-panel[data-panel="${p}"]`);
          for (const btn of root?.querySelectorAll('button[aria-expanded]') ?? []) {
            if (btn.textContent.trim().startsWith(t) && (btn.getAttribute('aria-expanded') === 'true') !== o) {
              btn.click();
            }
          }
        },
        panel,
        title,
        isOpen,
      );
      await sleep(UI_SETTLE_MS);
    },

    /** Capture one image. crop: 'app' | 'viewport' | { panel } | { el, pad } |
     *  { union: [spec…], pad } (a bare element spec works as { el }). marks: [{ n, el, at }] — numbered boxes the
     *  guide draws over the image; `at` moves the badge off the default top
     *  left ('tr' | 'bl' | 'br') where neighbours would collide. gpu: true =
     *  only worth taking on a real GPU (skipped headless); 'prefer' = shows
     *  the 3D view but still useful without it (taken headless until a GPU
     *  run has captured it, never downgraded after). */
    async shot(id, { crop = 'app', marks = [], gpu = false, pad = 6 } = {}) {
      seen.add(id);
      if (gpu === true && !hasGpu) {
        console.log(`  - ${id} (gpu — skipped headless, previous image kept)`);
        return;
      }
      if (gpu === 'prefer' && !hasGpu && data.shots[id]?.fromGpu) {
        console.log(`  - ${id} (keeps its GPU capture)`);
        return;
      }
      // a covered / background window stops rendering — the shot would be a stale frame
      if (gpu) {
        await page.bringToFront();
      }
      // park the mouse so no hover state or tooltip leaks into the image
      await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2);
      await sleep(gpu ? GPU_SETTLE_MS : UI_SETTLE_MS);
      const clip = await page.evaluate(
        (c, p) => {
          const grow = (r, by) => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });
          if (c === 'app') {
            return { x: 0, y: 0, w: innerWidth, h: innerHeight };
          }
          if (c === 'viewport') {
            return window.__doc.panelFrame('viewport');
          }
          if (c.panel) {
            return window.__doc.panelFrame(c.panel, c.fit);
          }
          const rects = (c.union ?? [c.el ?? c]).map((s) => window.__doc.rectOf(s)).filter(Boolean);
          if (!rects.length) {
            return null;
          }
          const x = Math.min(...rects.map((r) => r.x));
          const y = Math.min(...rects.map((r) => r.y));
          const box = {
            x,
            y,
            w: Math.max(...rects.map((r) => r.x + r.w)) - x,
            h: Math.max(...rects.map((r) => r.y + r.h)) - y,
          };
          return grow(box, c.pad ?? p);
        },
        crop,
        pad,
      );
      if (!clip) {
        throw new Error(`docs-shots: crop target missing for ${id}`);
      }
      const box = {
        x: Math.max(0, Math.floor(clip.x)),
        y: Math.max(0, Math.floor(clip.y)),
        w: Math.ceil(Math.min(clip.w, VIEWPORT.width - clip.x)),
        h: Math.ceil(Math.min(clip.h, VIEWPORT.height - clip.y)),
      };
      const markBoxes = [];
      for (const m of marks) {
        const r = await page.evaluate((s) => window.__doc.rectOf(s), m.el);
        if (!r) {
          throw new Error(`docs-shots: mark ${m.n} of ${id} not found ${JSON.stringify(m.el)}`);
        }
        const x = r.x - box.x;
        const y = r.y - box.y;
        if (x < -1 || y < -1 || x + r.w > box.w + 1 || y + r.h > box.h + 1) {
          throw new Error(`docs-shots: mark ${m.n} of ${id} lies outside the crop`);
        }
        markBoxes.push({ n: m.n, x, y, w: r.w, h: r.h, ...(m.at ? { at: m.at } : {}) });
      }
      await page.screenshot({
        path: resolve(OUT_DIR, `${id}.webp`),
        type: 'webp',
        quality: WEBP_QUALITY,
        clip: { x: box.x, y: box.y, width: box.w, height: box.h },
      });
      data.shots[id] = { w: box.w, h: box.h, gpu: gpu === true, marks: markBoxes, ...(hasGpu ? { fromGpu: true } : {}) };
      console.log(`  ✓ ${id}`);
    },

    /** Harvest a panel's controls (label, icon, tooltip, hotkey) into the
     *  reference table, grouped by Collapsible section. `rename` maps a
     *  tooltip prefix to a label for controls without visible text;
     *  `sectionAlias` maps a section-title regex to a display name ('' =
     *  controls outside any section); `extra` adds rows for fields that
     *  carry no tooltip ({ section, label, tooltip, keys?, first? }, placed
     *  at the end of their section, or its start with `first`). `skip` drops
     *  controls whose description starts with one of its prefixes. `key`
     *  stores the table under another name (data-ref), so one panel can
     *  yield several tables — e.g. one per Settings tab. */
    async harvest(panel, { rename = {}, sectionAlias = {}, skip = [], extra = [], key = panel } = {}) {
      const rows = await page.evaluate(
        async (p, ren, alias, sk) => {
          const { hotkeysActions, formatSequence } = await import('/src/treDeSpaceUI/hotkeys/index.ts');
          const root = document.querySelector(`.dock-panel[data-panel="${p}"]`);
          const out = [];
          const seen = new Set();
          const aliased = (t) => Object.entries(alias).find(([re]) => re && new RegExp(re).test(t))?.[1] ?? t;
          // a Collapsible (header button) or a ribbon group (title strip as last child)
          const sectionName = (el) => {
            for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
              const head = a.querySelector(':scope > div > button[aria-expanded]');
              if (head && !head.contains(el)) {
                return aliased(head.textContent.trim());
              }
              const strip = a.lastElementChild;
              if (a.childElementCount === 2 && strip?.matches('.text-center.font-semibold') && !strip.contains(el)) {
                return aliased(strip.textContent.trim());
              }
            }
            return alias[''] ?? '';
          };
          for (const el of root.querySelectorAll('[data-tooltip],[data-shortcut]')) {
            const tooltip = el.dataset.tooltip ?? '';
            const shortcut = el.dataset.shortcut ?? '';
            const desc = tooltip || (shortcut ? (hotkeysActions.describe(shortcut) ?? '') : '');
            if (tooltip === 'Clear' || tooltip === 'More info' || sk.some((s) => desc.startsWith(s))) {
              continue;
            }
            const renamed = Object.entries(ren).find(([k]) => desc.startsWith(k));
            const text = el.textContent.trim();
            const label = renamed ? renamed[1] : text || '';
            const seq = shortcut ? hotkeysActions.sequenceFor(shortcut) : null;
            const keys = seq ? formatSequence(seq) : '';
            // a dropdown's caret is not an icon worth showing
            const svg = el.matches('[aria-haspopup]') ? null : el.querySelector('svg');
            const icon = svg ? svg.outerHTML.replace(/width="\d+"/, 'width="14"').replace(/height="\d+"/, 'height="14"') : '';
            const section = sectionName(el);
            const key = `${section}\0${label}\0${desc}`;
            if (seen.has(key)) {
              continue;
            }
            seen.add(key);
            out.push({ section, label, icon, tooltip: desc, keys });
          }
          return out;
        },
        panel,
        rename,
        sectionAlias,
        skip,
      );
      for (const { first, ...x } of extra) {
        const last = rows.findLastIndex((r) => r.section === x.section);
        const at = first ? rows.findIndex((r) => r.section === x.section) : last < 0 ? -1 : last + 1;
        rows.splice(at < 0 ? rows.length : at, 0, { icon: '', keys: '', ...x });
      }
      data.reference[key] = rows;
      console.log(`  ✓ reference ${key} (${rows.length} controls)`);
    },

    sleep,
  };
  return ctx;
}

// -----------------------------------------------------------------------------
// browser + app lifecycle
// -----------------------------------------------------------------------------

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      return execSync(`command -v ${name}`, { shell: '/bin/bash' }).toString().trim();
    } catch {
      // keep looking
    }
  }
  const hit = execSync('find ~/.cache/puppeteer -type f -name chrome 2>/dev/null | head -1', { shell: '/bin/bash' })
    .toString()
    .trim();
  if (hit) {
    return hit;
  }
  console.error('docs-shots: no Chrome found — set $CHROME_BIN or run: npx @puppeteer/browsers install chrome@stable');
  process.exit(2);
}

function startVite() {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const up = new Promise((res, rej) => {
    vite.stdout.on('data', (d) => {
      if (d.toString().includes('Local:')) {
        res();
      }
    });
    vite.on('exit', (code) => rej(new Error(`vite exited early (code ${code})`)));
    setTimeout(() => rej(new Error('vite did not start within 30 s')), 30000);
  });
  return { vite, up };
}

const CONNECT_HINT =
  'start a separate browser with --remote-debugging-port=9222 and its own --user-data-dir ' +
  '(see the header of scripts/doc-shots.mjs); the chrome://inspect "Allow remote debugging" toggle is not enough';

function launchHeadless() {
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    acceptInsecureCerts: true,
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-webgpu-adapter=swiftshader',
    ],
  });
}

async function connectGpuBrowser(browserURL) {
  try {
    return await puppeteer.connect({ browserURL, defaultViewport: VIEWPORT, acceptInsecureCerts: true });
  } catch (e) {
    throw new Error(`${e.message}\n  hint: ${CONNECT_HINT}`);
  }
}

/** Boot the app in a fresh incognito context. Vite re-optimizes deps after
 *  edits and the first navigation can then hang, so a timed-out boot is
 *  retried with a new context. */
async function openApp(browser, appUrl, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await bootApp(browser, appUrl);
    } catch (e) {
      if (i >= attempts || !/timeout/i.test(e.message)) {
        throw e;
      }
      console.log(`  … app boot timed out, retrying (${i}/${attempts - 1})`);
    }
  }
}

async function bootApp(browser, appUrl) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(VIEWPORT);
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  await page.evaluateOnNewDocument(installPageHelpers);
  try {
    await page.goto(appUrl, { waitUntil: 'load', timeout: 90000 });
    await page.waitForSelector('.dock-panel[data-panel="viewport"]', { timeout: 60000 });
    await page.waitForFunction(
      async () => !!(await import('/src/state/viewer/viewer.actions.ts')).getRenderer(),
      { timeout: 60000, polling: 500 },
    );
  } catch (e) {
    await context.close();
    throw e;
  }
  await sleep(BOOT_SETTLE_MS);
  return { context, page };
}

// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------

/** Every scene module, in file-name order. */
async function loadScenes() {
  const files = readdirSync(SCENE_DIR)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
    .sort();
  const scenes = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(resolve(SCENE_DIR, f)).href);
    scenes.push(mod.scene);
  }
  return scenes;
}

/** Queue behind any other running docs:shots (one vite port, one CPU budget);
 *  a lock left by a dead process is taken over. */
async function acquireLock() {
  for (;;) {
    try {
      mkdirSync(LOCK_DIR);
      writeFileSync(resolve(LOCK_DIR, 'pid'), String(process.pid));
      return;
    } catch {
      const pid = Number(readFileSafe(resolve(LOCK_DIR, 'pid')));
      if (pid && !isAlive(pid)) {
        rmSync(LOCK_DIR, { recursive: true, force: true });
        continue;
      }
      await sleep(LOCK_POLL_MS);
    }
  }
}

function readFileSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Run one scene and rewrite its data file: shots it took or skipped stay,
 *  ids it no longer produces are dropped together with their images. */
async function runScene(browser, appUrl, scene) {
  const file = resolve(DATA_DIR, `${scene.id}.json`);
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { shots: {}, reference: {} };
  const before = Object.keys(data.shots);
  const seen = new Set();
  data.reference = {};
  const { context, page } = await openApp(browser, appUrl);
  // Vite reloads the page when a source file changes; a reload mid-scene wipes
  // the scene's state, so its later pictures would be wrong — fail instead
  let reloaded = false;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      reloaded = true;
    }
  });
  try {
    await scene.run(makeContext(page, data, seen));
  } finally {
    await context.close();
  }
  if (reloaded) {
    throw new Error('the page reloaded during the scene (a file changed while it ran?) — rerun it');
  }
  for (const id of before) {
    if (!seen.has(id)) {
      delete data.shots[id];
      rmSync(resolve(OUT_DIR, `${id}.webp`), { force: true });
      console.log(`  ✗ ${id} (no longer produced — removed)`);
    }
  }
  data.appVersion = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

let vite = null;
let browser = null;
let hasLock = false;
let failed = false;
try {
  const scenes = (await loadScenes()).filter((sc) => !only || only.has(sc.id));
  if (only && scenes.length !== only.size) {
    throw new Error(`unknown scene id in --only ${opts.only}`);
  }
  await acquireLock();
  hasLock = true;
  let appUrl = opts['app-url'];
  if (!appUrl) {
    const v = startVite();
    vite = v.vite;
    await v.up;
    appUrl = `https://localhost:${PORT}/`;
  }
  // headless: a fresh browser per scene — one long swiftshader session degrades
  // after a few scenes (random missing elements / timeouts); GPU: connect once
  if (hasGpu) {
    browser = await connectGpuBrowser(opts['browser-url']);
  }
  for (const scene of scenes) {
    console.log(`scene ${scene.id}`);
    const sceneBrowser = browser ?? (await launchHeadless());
    try {
      await runScene(sceneBrowser, appUrl, scene);
    } catch (e) {
      failed = true;
      console.error(`docs-shots: scene ${scene.id} failed — ${process.env.DEBUG ? e.stack : e.message}`);
    } finally {
      if (!hasGpu) {
        await sceneBrowser.close();
      }
    }
  }
} catch (e) {
  failed = true;
  console.error('docs-shots:', e.message);
} finally {
  await browser?.disconnect();
  vite?.kill();
  if (hasLock) {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
