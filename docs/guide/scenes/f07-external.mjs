// Guide scene: F7 External (f07-external.html). The External ribbon only has
// buttons once apps are configured, so the scene adds a few through the same
// action Settings → External uses. Only the "User guide" entry is ever opened:
// it points at this guide on the viewer's own server, so nothing depends on
// the network. The example.com entries only show as buttons.
import { layout, PANEL_W, SAMPLES, stack } from './_lib.mjs';

const RX = { panel: 'ribbonExternal' };
const RH = { panel: 'ribbonHome' };
const SETTINGS = { panel: 'settings' };

/** Configure the demo apps (what an administrator would enter in Settings → External). */
async function addApps(ctx) {
  await ctx.eval(async () => {
    const { externalAppsActions: ea } = await import('/src/state/externalApps.state.ts');
    ea.add({
      name: 'User guide',
      url: new URL('docs/guide/index.html', document.baseURI).href,
      section: 'Help',
      size: 'big',
      tooltip: 'Open the user guide in a panel',
    });
    ea.add({
      name: 'Tag report',
      url: 'https://tools.example.com/tag-report',
      section: 'Project tools',
      size: 'medium',
    });
    ea.add({
      name: 'Work orders',
      url: 'https://tools.example.com/work-orders',
      section: 'Project tools',
      size: 'medium',
      newWindow: true,
    });
    ea.add({
      name: 'Project selector',
      url: 'https://tools.example.com/projects',
      section: 'Project',
      size: 'big',
      modal: true,
      home: true,
    });
  });
  await ctx.sleep(400);
}

async function guidePanelId(ctx) {
  return ctx.eval(async () => {
    const { externalAppsState } = await import('/src/state/externalApps.state.ts');
    return `ext:${externalAppsState.get().apps.find((a) => a.name === 'User guide').id}`;
  });
}

async function captureLayout(ctx) {
  await layout(ctx, 7);
  await ctx.shot('f07-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonExternal') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewport') },
      { n: 4, el: { css: '.dock-tab[data-tab="console"]' }, at: 'tr' },
    ],
  });
  await ctx.shot('f07-ribbon', {
    crop: { union: [{ ...RX, section: 'Help' }, { ...RX, section: 'Project tools' }] },
    marks: [
      { n: 1, el: { ...RX, text: 'User guide' } },
      { n: 2, el: { ...RX, text: 'Tag report' } },
      { n: 3, el: { ...RX, text: 'Work orders' } },
      { n: 4, el: { ...RX, section: 'Project tools', css: ':scope > :last-child' } },
    ],
  });
}

async function capturePanel(ctx) {
  await ctx.click({ ...RX, text: 'User guide' });
  await ctx.sleep(2500);
  const id = await guidePanelId(ctx);
  await ctx.shot('f07-panel', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: { ...RX, text: 'User guide' } },
      { n: 2, el: stack(id) },
    ],
  });
  // switching layout drops the app panel again
  await layout(ctx, 7);
}

async function captureHome(ctx) {
  // F1 focuses the Home ribbon
  await layout(ctx, 1);
  await ctx.shot('f07-home', {
    crop: { union: [{ ...RH, section: 'Project' }, { ...RH, section: 'Assets' }] },
    marks: [{ n: 1, el: { ...RH, text: 'Project selector' } }],
  });
}

async function captureSettings(ctx) {
  await ctx.open('settings');
  await ctx.eval(async () => {
    const { settingsTabState } = await import('/src/components/panels/settings/settings.state.ts');
    settingsTabState.set({ tab: 'external' });
  });
  await ctx.sleep(400);
  await ctx.widen('settings', PANEL_W + 180);
  await ctx.section('settings', 'Tag report');
  const ED = { ...SETTINGS, section: 'Tag report' };
  await ctx.shot('f07-settings', {
    crop: { el: ED },
    marks: [
      { n: 1, el: { ...ED, css: 'input', nth: 0 } },
      { n: 2, el: { ...ED, css: 'input', nth: 1 } },
      { n: 3, el: { ...ED, css: 'input', nth: 2 } },
      { n: 4, el: { ...ED, text: 'Multiple instances' } },
      { n: 5, el: { ...ED, text: 'New window' } },
      { n: 6, el: { ...ED, text: 'Modal dialog' } },
      { n: 7, el: { ...ED, text: 'Show in Home' } },
      { n: 8, el: { ...ED, text: 'Open on start' } },
    ],
  });
}

async function f07Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await addApps(ctx);
  await captureLayout(ctx);
  await capturePanel(ctx);
  await captureHome(ctx);
  await captureSettings(ctx);
}

export const scene = { id: 'f07', run: f07Scene };
