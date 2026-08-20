// Boot test: launch the dev app headless and fail on any uncaught page error.
// Catches boot-time validation that a static build can't — most importantly
// installHotkeys()'s validateBindings(), which throws in dev on duplicate or
// unparseable default key bindings (they are built from templates and arrays,
// so only actually running the table validates it).
//
// Chrome resolution: $CHROME_BIN, then PATH names, then the puppeteer cache.
// Install one with: npx @puppeteer/browsers install chrome@stable
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      return execSync(`command -v ${name}`, { shell: '/bin/bash' }).toString().trim();
    } catch {
      /* keep looking */
    }
  }
  try {
    const hit = execSync('find ~/.cache/puppeteer -type f -name chrome 2>/dev/null | head -1', { shell: '/bin/bash' })
      .toString()
      .trim();
    if (hit) return hit;
  } catch {
    /* fall through */
  }
  console.error('boot-test: no Chrome found — set $CHROME_BIN or run: npx @puppeteer/browsers install chrome@stable');
  process.exit(2);
}

const PORT = 5199;
const chrome = findChrome();
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
const viteUp = new Promise((resolve, reject) => {
  vite.stdout.on('data', (d) => {
    if (d.toString().includes('Local:')) resolve();
  });
  vite.on('exit', (code) => reject(new Error(`vite exited early (code ${code})`)));
  setTimeout(() => reject(new Error('vite did not start within 30 s')), 30000);
});

let failed = false;
try {
  await viteUp;
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      '--no-sandbox',
      '--ignore-certificate-errors', // vite dev serves HTTPS with a self-signed cert (basicSsl)
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-webgpu-adapter=swiftshader',
    ],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    failed = true;
    console.error('[pageerror]', e.message);
  });
  await page.goto(`https://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 5000)); // let boot + hotkey install run
  await browser.close();
} catch (e) {
  failed = true;
  console.error('boot-test:', e.message);
} finally {
  vite.kill();
}

console.log(failed ? 'boot-test: FAILED' : 'boot-test: OK — app booted with no uncaught errors');
process.exit(failed ? 1 : 0);
