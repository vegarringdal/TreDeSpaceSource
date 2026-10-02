// Guide scene: F1 Home (f01-home.html) — the layout, the Home ribbon group by
// group, the Hierarchy panel (search, toolbar, right-click menu) and the
// Console. The Settings panel on the right is documented in panel-settings.html.
import { fitView, layout, SAMPLES, select, stack, VIEWER } from './_lib.mjs';

const RB = { panel: 'ribbonHome' };
const HI = { panel: 'hierarchy' };
const CON = { panel: 'console' };
const HI_HEAD = { css: 'section.dock-tabs:has(.dock-panel[data-panel="hierarchy"]) > header' };
/** Tab strip down to the last discipline row — the empty tree below is left out. */
const HI_CROP = { union: [HI_HEAD, { ...HI, text: '/HA-TELE' }], pad: 4 };

async function captureLayout(ctx) {
  await layout(ctx, 1);
  await ctx.shot('f01-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonHome') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewport') },
      { n: 4, el: stack('console') },
      { n: 5, el: stack('settings') },
    ],
  });
}

async function captureRibbon(ctx) {
  await ctx.shot('f01-assets', {
    crop: { el: { ...RB, section: 'Assets' } },
    marks: [
      { n: 1, el: { ...RB, text: 'Model' } },
      { n: 2, el: { ...RB, text: 'Import' } },
      { n: 3, el: { ...RB, text: 'SQL' } },
      { n: 4, el: { ...RB, text: 'Wipe All' } },
    ],
  });
  await ctx.shot('f01-canvas', {
    crop: { el: { ...RB, section: 'Canvas' } },
    marks: [
      { n: 1, el: { ...RB, text: 'Clear' } },
      { n: 2, el: { ...RB, text: 'Screenshot' } },
      { n: 3, el: { ...RB, text: 'Persp.' } },
      { n: 4, el: { ...RB, text: 'Ortho' } },
      { n: 5, el: { ...RB, text: 'Dark' } },
    ],
  });
  await ctx.shot('f01-drawmode', {
    crop: { el: { ...RB, section: 'Draw Mode' } },
    marks: [
      { n: 1, el: { ...RB, text: 'Sketch' } },
      { n: 2, el: { ...RB, text: 'Wire' } },
      { n: 3, el: { ...RB, text: 'Colour Fill' } },
      { n: 4, el: { ...RB, text: 'Colour Wire' } },
      { n: 5, el: { ...RB, text: 'Selection Tint' } },
      { n: 6, el: { ...RB, text: 'Selection Outline' } },
      { n: 7, el: { ...RB, text: 'Selection Both' } },
    ],
  });
  await ctx.shot('f01-quickclear', {
    crop: { el: { ...RB, section: 'Quick Clear' } },
    marks: [
      { n: 1, el: { ...RB, section: 'Quick Clear', text: 'Label' } },
      { n: 2, el: { ...RB, section: 'Quick Clear', text: 'Measurement' } },
    ],
  });
}

/** The tree with one discipline hidden and another selected, so the
 *  partial-selection bar and the hidden badges show. */
async function captureHierarchy(ctx) {
  await select(ctx, '/HA-TELE');
  await ctx.call(VIEWER, 'viewerActions', 'hideSelection');
  await ctx.call(VIEWER, 'viewerActions', 'clearSelection');
  await select(ctx, '/HA-SAFE');
  await ctx.shot('f01-hierarchy', {
    crop: HI_CROP,
    marks: [
      { n: 1, el: { ...HI, css: 'input[type="search"]' } },
      { n: 2, el: { ...HI, tooltip: 'Contains' }, at: 'tr' },
      { n: 3, el: { ...HI, tooltip: 'Fly to selection' } },
      { n: 4, el: { ...HI, tooltip: 'Focus last click' }, at: 'bl' },
      { n: 5, el: { ...HI, tooltip: 'Go to last click' } },
      { n: 6, el: { ...HI, tooltip: 'Focus selection' }, at: 'bl' },
      { n: 7, el: { ...HI, tooltip: 'Fit visible' } },
      { n: 8, el: { ...HI, tooltip: 'Collapse the whole tree' }, at: 'bl' },
    ],
  });

  await ctx.type({ ...HI, css: 'input[type="search"]' }, 'safe');
  await ctx.sleep(600);
  await ctx.shot('f01-search', {
    crop: HI_CROP,
    marks: [
      { n: 1, el: { ...HI, css: 'input[type="search"]' } },
      { n: 2, el: { ...HI, css: '.max-h-56' } },
    ],
  });
  await ctx.type({ ...HI, css: 'input[type="search"]' }, '');

  const row = await ctx.handle({ ...HI, text: '/HA-SAFE' });
  await row.click({ button: 'right' });
  await ctx.sleep(400);
  await ctx.shot('f01-hierarchy-menu', {
    crop: { union: [{ ...HI, text: '/HA-SAFE' }, { css: '[role="menu"]' }], pad: 8 },
  });
  await ctx.page.mouse.click(2, 300);
  await ctx.sleep(300);
}

async function captureConsole(ctx) {
  await ctx.shot('f01-console', {
    crop: stack('console'),
    marks: [
      { n: 1, el: { ...CON, tooltip: 'Show / hide info' } },
      { n: 2, el: { ...CON, tooltip: 'Download the whole console' } },
      { n: 3, el: { ...CON, tooltip: 'Clear the console' }, at: 'tr' },
    ],
  });
}

/** The sketch look, for the Draw Mode task. */
async function captureTasks(ctx) {
  await ctx.call(VIEWER, 'viewerActions', 'clearSelection');
  await ctx.click({ ...RB, text: 'Sketch' });
  await ctx.click({ ...RB, text: 'Colour Fill' });
  await fitView(ctx);
  await ctx.shot('f01-task-sketch-viewport', { crop: 'viewport', gpu: true });
  await ctx.click({ ...RB, text: 'Wire' });
  await ctx.click({ ...RB, text: 'Sketch' });
}

async function harvestAll(ctx) {
  await ctx.harvest('ribbonHome');
  await ctx.harvest('hierarchy', {
    rename: {
      'Contains —': 'Contains (*)',
      'Equals —': 'Equals (=)',
      'Fly to selection': 'Fly to selection',
      'Focus last click': 'Focus last click',
      'Go to last click': 'Go to last click',
      'Focus selection': 'Focus selection',
      'Fit visible': 'Fit visible',
      'Collapse the whole tree': 'Collapse all',
      'Partly selected': 'Blue bar on a row',
      'Hidden (hide': 'Crossed-out eye',
      'Some items below are hidden': 'Dotted eye',
    },
    sectionAlias: { '': 'Hierarchy' },
    extra: [
      {
        section: '',
        label: 'Search items…',
        tooltip: 'Type at least two letters of a name. Up to ten matches are listed, highest level first; click one to select it.',
        first: true,
      },
    ],
  });
  await ctx.harvest('console', {
    rename: {
      'Show / hide info': 'INFO',
      'Show / hide warn': 'WARN',
      'Show / hide error': 'ERROR',
      'Download the whole console': 'Download',
      'Clear the console': 'Clear',
    },
    sectionAlias: { '': 'Console' },
  });
}

async function f01Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await captureLayout(ctx);
  await captureRibbon(ctx);
  await captureHierarchy(ctx);
  await captureConsole(ctx);
  await harvestAll(ctx);
  await captureTasks(ctx);
}

export const scene = { id: 'f01', run: f01Scene };
