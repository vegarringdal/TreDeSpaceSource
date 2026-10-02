// Guide scene: the start page (index.html) — one full-screen picture per app
// layout (F1-F12), the App Layout ribbon and Settings → Layouts.
import { layout, PANEL_W, SAMPLES } from './_lib.mjs';

const LR = { panel: 'ribbonLayout' };

/** Every preset layout, as the F-key shows it. */
async function captureLayouts(ctx) {
  for (let n = 1; n <= 12; n++) {
    await layout(ctx, n);
    await ctx.shot(`layout-f${String(n).padStart(2, '0')}`, { crop: 'app', gpu: 'prefer' });
  }
}

async function captureLayoutRibbon(ctx) {
  await layout(ctx, 1);
  await ctx.open('ribbonLayout');
  await ctx.click({ ...LR, text: 'Config01' });
  await ctx.shot('layout-ribbon', {
    crop: { union: [{ css: '.dock-tab[data-tab="ribbonHome"]' }, { ...LR, section: 'Override Selected' }] },
    marks: [
      { n: 1, el: { ...LR, text: 'Home' } },
      { n: 2, el: { ...LR, text: 'Config01' } },
      { n: 3, el: { ...LR, tooltip: 'Save the current panel layout' } },
      { n: 4, el: { ...LR, tooltip: 'Ribbon tab focused' } },
      { n: 5, el: { ...LR, text: 'Ribbon Open' }, at: 'bl' },
    ],
  });
  await ctx.harvest('ribbonLayout', {
    rename: {
      'Ribbon tab focused': 'Linked Ribbon',
      'Show the ribbon strip': 'Ribbon Open',
      'Collapse the ribbon strip': 'Ribbon Closed',
    },
    // the 24 slot buttons all mean the same — one summary row per section instead
    skip: ['Apply layout', 'Select empty slot'],
    extra: [
      {
        section: 'Configured App Layouts (Shortcut F1-F12)',
        label: 'Preset layouts',
        tooltip: 'Click one to switch to that layout. It also becomes the target for Save.',
        keys: 'F1 … F12',
      },
      {
        section: 'Configured App Layout (ALT + F1-F12)',
        label: 'Your layouts (Config01–12)',
        tooltip: 'Empty until you save into them. Click one to switch to it, or to choose it as the target for Save.',
        keys: 'ALT+F1 … ALT+F12',
      },
    ],
  });
}

async function captureLayoutsTab(ctx) {
  await layout(ctx, 8);
  await ctx.widen('settings', PANEL_W);
  await ctx.shot('layout-settings-tab', {
    crop: {
      union: [{ css: '.dock-tab[data-tab="settings"]' }, { panel: 'settings', tooltip: 'Reset this slot', nth: 5 }],
      pad: 8,
    },
    marks: [
      { n: 1, el: { panel: 'settings', css: 'input', nth: 0 } },
      { n: 2, el: { panel: 'settings', tooltip: 'Reset this slot', nth: 0 }, at: 'tr' },
    ],
  });
}

async function overviewScene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await captureLayouts(ctx);
  await captureLayoutRibbon(ctx);
  await captureLayoutsTab(ctx);
}

export const scene = { id: 'overview', run: overviewScene };
