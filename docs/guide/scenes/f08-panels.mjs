// Guide scene: F8 Panels (f08-panels.html) — the layout, the Panel ribbon,
// and how panels are moved around: the tab strip, the dock compass while
// dragging, and a floating window. Settings → Layouts on the right is
// documented on the start page (layout-settings-tab, overview scene).
import { layout, SAMPLES, stack } from './_lib.mjs';

const RP = { panel: 'ribbonPanels' };
const EXT_APPS = '/src/state/externalApps.state.ts';
const EXT_APP_NAME = 'Work Orders';
const RIGHT_STRIP = 'section.dock-tabs:has(.dock-panel[data-panel="settings"])';

async function captureLayout(ctx) {
  await layout(ctx, 8);
  await ctx.shot('f08-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonPanels') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewport') },
      { n: 4, el: stack('settings') },
      { n: 5, el: { css: '.dock-tab[data-tab="console"]' }, at: 'tr' },
    ],
  });
}

/** An external app opened once as a panel, so the External Panels group
 *  appears on the ribbon (it lists only apps that open as a panel). */
async function addExternalPanel(ctx) {
  await ctx.call(EXT_APPS, 'externalAppsActions', 'add', { name: EXT_APP_NAME, url: 'about:blank', section: 'Tools' });
  await ctx.open('ribbonExternal');
  await ctx.click({ panel: 'ribbonExternal', text: EXT_APP_NAME });
  await ctx.sleep(500);
  await layout(ctx, 8);
}

async function captureRibbon(ctx) {
  await ctx.shot('f08-ribbon', {
    crop: { panel: 'ribbonPanels', fit: true },
    marks: [
      { n: 1, el: { ...RP, text: 'Hierarchy' } },
      { n: 2, el: { ...RP, text: 'Set Color' } },
      { n: 3, el: { ...RP, section: 'External Panels' } },
    ],
  });
}

/** Two panels sharing the right-hand stack, so the strip shows tabs. */
async function captureTabStrip(ctx) {
  await ctx.click({ ...RP, text: 'Set Color' });
  await ctx.shot('f08-tabstrip', {
    crop: { el: { css: `${RIGHT_STRIP} > header` }, pad: 4 },
    marks: [
      { n: 1, el: { css: '.dock-tab[data-tab="settings"]' } },
      { n: 2, el: { css: '.dock-tab[data-tab="multiColor"] .dock-tab-close' }, at: 'tr' },
      { n: 3, el: { css: `${RIGHT_STRIP} .dock-strip-actions button`, nth: 0 }, at: 'bl' },
      { n: 4, el: { css: `${RIGHT_STRIP} .dock-strip-actions button`, nth: 1 }, at: 'tr' },
    ],
  });
}

/** Point the screenshot runner's pointer-parking move at (x, y) instead of
 *  the screen corner: a capture listener swallows real pointer moves near the
 *  right edge and re-sends them at that point, so a drag in progress keeps
 *  aiming where the scene put it while the shot is taken. */
async function holdPointerAt(ctx, x, y) {
  await ctx.eval(
    (px, py) => {
      const redirect = (e) => {
        if (e.isTrusted && e.clientX > innerWidth - 10) {
          e.stopImmediatePropagation();
          window.dispatchEvent(new PointerEvent('pointermove', { clientX: px, clientY: py, bubbles: true, pointerType: 'mouse' }));
        }
      };
      window.__docRedirect = redirect;
      window.addEventListener('pointermove', redirect, true);
    },
    x,
    y,
  );
}

async function releasePointer(ctx) {
  await ctx.eval(() => window.removeEventListener('pointermove', window.__docRedirect, true));
}

/** Mid-drag of the Console tab, aimed at the middle of the Settings stack:
 *  the dock compass shows there, its centre button lit. */
async function captureCompass(ctx) {
  const tab = await ctx.handle({ css: '.dock-tab[data-tab="console"]' });
  const box = await tab.boundingBox();
  const target = await (await ctx.handle({ css: RIGHT_STRIP })).boundingBox();
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  await ctx.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ctx.page.mouse.down();
  await ctx.page.mouse.move(box.x + 40, box.y - 120, { steps: 6 });
  await ctx.page.mouse.move(cx + 120, cy + 160, { steps: 6 });
  await holdPointerAt(ctx, cx, cy);
  await ctx.shot('f08-compass', {
    crop: stack('settings'),
    marks: [
      { n: 1, el: { css: '.dock-compass-btn--center' }, at: 'br' },
      { n: 2, el: { css: '.dock-compass-btn--left:not(.dock-compass-btn--outer)' } },
      { n: 3, el: { css: '.dock-compass-btn--left.dock-compass-btn--outer' }, at: 'bl' },
    ],
  });
  await releasePointer(ctx);
  await ctx.page.keyboard.press('Escape');
  await ctx.page.mouse.up();
  await layout(ctx, 8);
}

async function captureFloating(ctx) {
  await ctx.click({ ...RP, text: 'Set Color' });
  const tab = await ctx.handle({ css: '.dock-tab[data-tab="multiColor"]' });
  await tab.click({ count: 2 });
  await ctx.sleep(500);
  await ctx.shot('f08-floating', {
    crop: { el: { css: '.dock-window' }, pad: 10 },
    marks: [
      { n: 1, el: { css: '.dock-window-title' } },
      { n: 2, el: { css: '.dock-window-btn', nth: 0 }, at: 'bl' },
      { n: 3, el: { css: '.dock-window-btn', nth: 1 }, at: 'bl' },
      { n: 4, el: { css: '.dock-window-btn', nth: 2 }, at: 'br' },
    ],
  });
  await ctx.click({ css: '.dock-window-btn', nth: 1 });
  await layout(ctx, 8);
}

async function f08Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await captureLayout(ctx);
  await addExternalPanel(ctx);
  await captureRibbon(ctx);
  await ctx.harvest('ribbonPanels', {
    sectionAlias: { '^External Panels': 'External Panels (example)' },
  });
  await captureTabStrip(ctx);
  await layout(ctx, 8);
  await captureCompass(ctx);
  await captureFloating(ctx);
}

export const scene = { id: 'f08', run: f08Scene };
