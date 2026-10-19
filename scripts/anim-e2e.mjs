// Animation end-to-end suite: the app in headless Chrome (swiftshader), the
// sample models loaded once, then every scenario of tests/e2e/animation.e2e.mjs
// from a clean authoring state (tests/e2e/animProbe.ts resets and reads back).
// The scenarios drive the app through the same actions its buttons and
// hotkeys call and check objects, keys, poses, the gizmo, the camera, the
// steps and the player.
//
//   npm run test:anim                 every scenario
//   npm run test:anim -- --only a,b   scenarios whose name contains a or b
//
// Headless has no GPU snapshot (video and step stills are not covered).

import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer-core';
const { SCENARIOS } = await import(process.env.E2E_FILE ?? '../tests/e2e/animation.e2e.mjs');

const ROOT = resolve(import.meta.dirname, '..');
const PORT = 5194;
const SAMPLES = ['HA-TELE'];
const VIEWPORT = { width: 1440, height: 900 };
const BOOT_SETTLE_MS = 2500;
/** App layout F10 (Animation) — index 9. */
const F10_LAYOUT = 9;
const PANELS = ['animation', 'animationTimeline', 'overlayEditor', 'overlayPreview', 'multiColor'];

const { values: opts } = parseArgs({ options: { only: { type: 'string' } } });
const only = opts.only ? opts.only.split(',') : null;

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  const hit = execSync('find ~/.cache/puppeteer -type f -name chrome 2>/dev/null | head -1', { shell: '/bin/bash' })
    .toString()
    .trim();
  if (!hit) {
    console.error('anim-e2e: no Chrome found — set $CHROME_BIN or run: npx @puppeteer/browsers install chrome@stable');
    process.exit(2);
  }
  return hit;
}

function startVite() {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const up = new Promise((res, rej) => {
    vite.stdout.on('data', (d) => d.toString().includes('Local:') && res());
    vite.on('exit', (code) => rej(new Error(`vite exited early (code ${code})`)));
    setTimeout(() => rej(new Error('vite did not start within 30 s')), 30000);
  });
  return { vite, up };
}

/** Boot, retried: after source edits Vite re-optimizes deps and the first
 *  navigation can hang. */
async function bootAppRetried(browser, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await bootApp(browser);
    } catch (e) {
      if (i >= attempts) {
        throw e;
      }
      console.log(`  … app boot failed (${e.message.split('\n')[0]}), retrying (${i}/${attempts - 1})`);
    }
  }
}

async function bootApp(browser) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // React warnings and console errors are defects too (nested buttons, keys…)
  page.on('console', (m) => {
    if (m.type() === 'error' || /^Warning:/.test(m.text())) {
      errors.push(`console: ${m.text().split('\n')[0].slice(0, 200)}`);
    }
  });
  if (process.env.DEBUG) {
    page.on('console', (m) => console.log('  [console]', m.text()));
  }
  page.goto(`https://localhost:${PORT}/`).catch((e) => console.log('  [goto]', e.message));
  try {
    await page.waitForSelector('.dock-panel[data-panel="viewport"]', { timeout: 120000 });
  } catch (e) {
    await page.close();
    throw e;
  }
  await page.waitForFunction(
    async () => !!(await import('/src/state/viewer/viewer.actions.ts')).getRenderer(),
    { timeout: 60000, polling: 500 },
  );
  await new Promise((r) => setTimeout(r, BOOT_SETTLE_MS));
  await page.evaluate(async (names) => {
    await (await import('/src/state/stores/stores.actions.ts')).storesActions.init();
    await (await import('/src/state/assets/assets.actions.ts')).assetsActions.init();
    const { assetsActions } = await import('/src/state/assets/assets.actions.ts');
    for (const n of names) {
      const bytes = await (await fetch(`/convertSamples/rvm/${n}.RVM`)).arrayBuffer();
      await assetsActions.importRvm(new File([bytes], `${n}.RVM`), { folder: 'E2E', load: true, temp: true, quiet: true });
    }
    await (await import('/src/state/viewer/viewer.actions.ts')).viewerActions.fitVisible({ wait: false });
  }, SAMPLES);
  // the F10 Animation layout plus every animation panel, so each scenario
  // also renders them (their React warnings and errors count as failures)
  await page.evaluate(async (ids, layout) => {
    await (await import('/src/state/layouts.state.ts')).layoutsActions.activate(layout);
    await new Promise((r) => setTimeout(r, 600));
    const { togglePanelById } = await import('/src/components/panels/ribbon-panels/panelToggle.ts');
    for (const id of ids) {
      if (!document.querySelector(`.dock-tab[data-tab="${id}"]`)) {
        togglePanelById(id);
      }
    }
  }, PANELS, F10_LAYOUT);
  return { page, errors };
}

/** What a scenario gets: the probe, app calls, and checks that collect failures. */
function makeTest(page, failures) {
  const close = (a, b, eps) =>
    Array.isArray(b)
      ? Array.isArray(a) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= eps)
      : typeof a === 'number' && Math.abs(a - b) <= eps;
  return {
    probe: (fn, ...args) =>
      page.evaluate(async (f, a) => (await import('/tests/e2e/animProbe.ts'))[f](...a), fn, args),
    call: (path, exp, method, ...args) =>
      page.evaluate(
        async (p, e, m, a) => {
          const mod = await import(p);
          return await mod[e][m].bind(mod[e])(...a);
        },
        path,
        exp,
        method,
        args,
      ),
    eval: (fn, ...args) => page.evaluate(fn, ...args),
    /** A real key press (trusted events, to whatever has the focus), with
     *  modifiers held: press('KeyI'), press('KeyC', ['Control']). */
    async press(key, modifiers = []) {
      for (const m of modifiers) {
        await page.keyboard.down(m);
      }
      await page.keyboard.press(key);
      for (const m of [...modifiers].reverse()) {
        await page.keyboard.up(m);
      }
    },
    /** The real mouse (trusted pointer events, so pointer capture works):
     *  move(x, y, { steps }), down(), up(). */
    mouse: page.mouse,
    /** A screenshot of the page (debugging a scenario). */
    shot: (path) => page.screenshot({ path }),
    check(cond, msg) {
      if (!cond) {
        failures.push(msg);
      }
    },
    near(actual, expected, msg, eps = 0.02) {
      if (!close(actual, expected, eps)) {
        failures.push(`${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
      }
    },
    equal(actual, expected, msg) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(`${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
      }
    },
  };
}

let vite = null;
let browser = null;
let failed = 0;
try {
  const scenarios = SCENARIOS.filter((s) => !only || only.some((o) => s.name.includes(o)));
  const v = startVite();
  vite = v.vite;
  await v.up;
  browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    acceptInsecureCerts: true,
    args: ['--no-sandbox', '--ignore-certificate-errors', '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader'],
  });
  const { page, errors } = await bootAppRetried(browser);
  for (const s of scenarios) {
    const failures = [];
    const t = makeTest(page, failures);
    const errorsBefore = errors.length;
    try {
      await t.probe('reset');
      if (process.env.DEBUG) {
        console.log('    [reset]', JSON.stringify(await t.probe('player')));
      }
      await s.run(t);
    } catch (e) {
      failures.push(`threw: ${e.message.split('\n')[0]}`);
    }
    for (const e of errors.slice(errorsBefore)) {
      failures.push(e.startsWith('console: ') ? e : `page error: ${e}`);
    }
    if (failures.length > 0) {
      failed++;
      console.log(`  ✗ ${s.name}`);
      for (const f of failures) {
        console.log(`      ${f}`);
      }
    } else {
      console.log(`  ✓ ${s.name}`);
    }
  }
  console.log(`\nanim-e2e: ${scenarios.length - failed} passed, ${failed} failed`);
} catch (e) {
  failed++;
  console.error('anim-e2e:', e.message);
} finally {
  await browser?.close();
  vite?.kill();
}
process.exit(failed > 0 ? 1 : 0);
