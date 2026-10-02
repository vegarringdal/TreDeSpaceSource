// Guide scene: F4 Selection Color (f04-selection-color.html) — the layout, the
// Selection Color ribbon group by group, and its tasks. The Set Color panel on
// the right is documented in panel-set-color.html.
import { fitView, layout, SAMPLES, select, stack, VIEWER } from './_lib.mjs';

const RB = { panel: 'ribbonSelectionColor' };

async function captureLayout(ctx) {
  await layout(ctx, 4);
  await ctx.shot('f04-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonSelectionColor') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewport') },
      { n: 4, el: stack('multiColor') },
      { n: 5, el: { css: '.dock-tab[data-tab="console"]' }, at: 'tr' },
    ],
  });
}

async function captureGroups(ctx) {
  await select(ctx, '/HA-SAFE');
  await ctx.shot('f04-hidden', {
    crop: { el: { ...RB, section: 'Hidden Items' } },
    marks: [
      { n: 1, el: { ...RB, text: 'Hide' } },
      { n: 2, el: { ...RB, text: 'Unhide Sel' } },
      { n: 3, el: { ...RB, text: 'Unhide All' } },
      { n: 4, el: { ...RB, text: 'Unhide Box' } },
      { n: 5, el: { ...RB, text: 'Unhide Sel+Off.' } },
      { n: 6, el: { ...RB, text: 'Unhide Each+Off.' } },
    ],
  });
  await ctx.shot('f04-quick', {
    crop: { el: { ...RB, section: 'Quick Coloring' } },
    marks: [
      { n: 1, el: { ...RB, css: '[data-shortcut="color.quick.1"]' } },
      { n: 2, el: { ...RB, section: 'Quick Coloring', text: 'Reset Sel' } },
      { n: 3, el: { ...RB, section: 'Quick Coloring', text: 'Reset All' } },
      { n: 4, el: { ...RB, text: 'Panel' } },
    ],
  });
  await ctx.shot('f04-opacity', {
    crop: { el: { ...RB, section: 'Opacity Override' } },
    marks: [
      { n: 1, el: { ...RB, section: 'Opacity Override', css: 'input' } },
      { n: 2, el: { ...RB, text: 'Set Sel' } },
      { n: 3, el: { ...RB, section: 'Opacity Override', text: 'Reset Sel' } },
      { n: 4, el: { ...RB, section: 'Opacity Override', text: 'Reset All' } },
    ],
  });
  await ctx.shot('f04-misc', {
    crop: { union: [{ ...RB, section: 'Misc' }, { ...RB, section: 'History' }] },
    marks: [
      { n: 1, el: { ...RB, text: 'Invert Sel' } },
      { n: 2, el: { ...RB, text: 'Isolate' } },
      { n: 3, el: { ...RB, text: 'Clear Sel' } },
      { n: 4, el: { ...RB, text: 'Clear All' } },
      { n: 5, el: { ...RB, text: 'Undo' } },
      { n: 6, el: { ...RB, text: 'Redo' } },
    ],
  });
  await ctx.shot('f04-clipselect', { crop: { el: { ...RB, section: 'Clipping Shape Select' } } });
}

/** Task pictures that only make sense with the 3D view. */
async function captureTasks(ctx) {
  await select(ctx, '/HA-PIPE');
  await ctx.click({ ...RB, css: '[data-shortcut="color.quick.1"]' });
  await ctx.call(VIEWER, 'viewerActions', 'clearSelection');
  await fitView(ctx);
  await ctx.shot('f04-task-color-viewport', { crop: 'viewport', gpu: true });

  await select(ctx, '/HA-MECH');
  await ctx.type({ ...RB, section: 'Opacity Override', css: 'input' }, '20');
  await ctx.click({ ...RB, text: 'Set Sel' });
  await ctx.call(VIEWER, 'viewerActions', 'clearSelection');
  await ctx.shot('f04-task-opacity-viewport', { crop: 'viewport', gpu: true });

  await select(ctx, '/HA-SAFE');
  await ctx.click({ ...RB, text: 'Isolate' });
  await fitView(ctx);
  await ctx.shot('f04-task-isolate-viewport', { crop: 'viewport', gpu: true });
  await ctx.click({ ...RB, text: 'Clear All' });
}

async function f04Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await captureLayout(ctx);
  await captureGroups(ctx);
  await captureTasks(ctx);
  await select(ctx, '/HA-SAFE');
  await ctx.harvest('ribbonSelectionColor', {
    rename: {
      'Hide the selected items': 'Hide',
      'Show every hidden item': 'Unhide All',
      'Decrease the opacity-override value': 'Opacity −',
      'Increase the opacity-override value': 'Opacity +',
    },
    skip: ['Apply quick-color slot'],
    extra: [
      {
        section: 'Quick Coloring',
        label: 'Colour swatches',
        tooltip: 'Colour the selection with that swatch. Change the swatches in the Color Panel.',
        keys: 'ALT 210 …',
        first: true,
      },
    ],
  });
}

export const scene = { id: 'f04', run: f04Scene };
