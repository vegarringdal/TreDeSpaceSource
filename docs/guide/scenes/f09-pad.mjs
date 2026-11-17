// Guide scene: F9 Pad (f09-pad.html) — the tablet ribbon group by group and the
// on-screen joysticks. Touch gestures themselves cannot be captured; the page
// describes them.
import { flyTo, layout, SAMPLES, stack } from './_lib.mjs';

const RP = { panel: 'ribbonPad' };
const PAD = { panel: 'viewport', css: 'div[style*="width: 224px"]' };

async function captureLayout(ctx) {
  await layout(ctx, 9);
  await flyTo(ctx, '/HA-TELE-PA');
  await ctx.shot('f09-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonPad') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewport') },
      { n: 4, el: { css: '.dock-tab[data-tab="console"]' }, at: 'tr' },
    ],
  });
}

async function captureGroups(ctx) {
  const view = ['Fly To', 'Focus Click', 'Go To Click', 'Focus Sel.', 'Fit Visible', 'Solo', 'Hide', 'Reset All', 'Clear Sel.'];
  await ctx.shot('f09-view', {
    crop: { el: { ...RP, section: 'View' } },
    marks: view.map((text, i) => ({ n: i + 1, el: { ...RP, section: 'View', text } })),
  });
  await ctx.shot('f09-tree-nav', {
    crop: { union: [{ ...RP, section: 'Tree' }, { ...RP, section: 'Nav' }] },
    marks: [
      { n: 1, el: { ...RP, text: 'Up' } },
      { n: 2, el: { ...RP, text: 'Down' } },
      { n: 3, el: { ...RP, text: 'Orbit' } },
      { n: 4, el: { ...RP, text: 'Fly' } },
      { n: 5, el: { ...RP, text: 'Walk' } },
    ],
  });
  await ctx.click({ ...RP, text: 'Joystick' });
  await ctx.shot('f09-controller', {
    crop: { el: { ...RP, section: 'Controller' } },
    marks: [
      { n: 1, el: { ...RP, text: 'Joystick' } },
      { n: 2, el: { ...RP, section: 'Controller', css: 'input', nth: 0 }, at: 'tr' },
      { n: 3, el: { ...RP, section: 'Controller', css: 'input', nth: 1 }, at: 'tr' },
    ],
  });
  await ctx.shot('f09-joystick', {
    crop: 'viewport',
    gpu: 'prefer',
    marks: [
      { n: 1, el: { ...PAD, nth: 0 } },
      { n: 2, el: { ...PAD, nth: 1 } },
    ],
  });
  await ctx.click({ ...RP, text: 'Joystick' });
}

async function f09Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await captureLayout(ctx);
  await captureGroups(ctx);
  await ctx.harvest('ribbonPad', {
    rename: {
      'Joystick position from the top edge': 'Top',
      'Joystick position from the side edges': 'Side',
      'Move both on-screen joysticks closer': 'Side −',
      'Move both on-screen joysticks inward': 'Side +',
      'Move the on-screen joystick up': 'Top −',
      'Move the on-screen joystick down': 'Top +',
    },
  });
}

export const scene = { id: 'f09', run: f09Scene };
