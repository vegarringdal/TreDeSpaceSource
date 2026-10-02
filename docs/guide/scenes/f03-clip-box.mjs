// Guide scene: F3 Clip Box (f03-clip-box.html) — the layout, the Clipping Box
// ribbon group by group, the Clip Shape List panel on the right (documented on
// this page only), and the tasks.
import { fitView, layout, PANEL_W, SAMPLES, select, stack, VIEWER } from './_lib.mjs';

const RB = { panel: 'ribbonClippingBox' };
const CS = { panel: 'clipShapes' };
const COMMON = { ...CS, section: 'Common' };

// -----------------------------------------------------------------------------
// local helpers
// -----------------------------------------------------------------------------

/** Set the orbit angles (degrees; negative elevation looks down) and frame
 *  what is still visible after clipping. */
async function view(ctx, azDeg, elDeg) {
  await ctx.eval(
    async (mod, az, el) => {
      const { getRenderer } = await import(mod);
      getRenderer()?.camera.setView((az * Math.PI) / 180, (el * Math.PI) / 180);
    },
    VIEWER,
    azDeg,
    elDeg,
  );
  await fitView(ctx);
}

/** Wait (up to 10 s) until the selection banner field `field` reaches `min`:
 *  the selection and transform-history counts update asynchronously, and a
 *  ribbon button reads them to decide whether it is greyed out. */
async function waitSel(ctx, field, min) {
  const isReady = await ctx.eval(
    async (f, m) => {
      const { selectionState } = await import('/src/state/viewer/selection.state.ts');
      for (let i = 0; i < 100; i++) {
        if (selectionState.get()[f] >= m) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    },
    field,
    min,
  );
  if (!isReady) {
    throw new Error(`docs-shots: selection ${field} never reached ${min}`);
  }
}

const unselect = (ctx) => ctx.call(VIEWER, 'viewerActions', 'clearSelection');

// -----------------------------------------------------------------------------
// shots
// -----------------------------------------------------------------------------

async function captureLayout(ctx) {
  await ctx.shot('f03-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonClippingBox') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewport') },
      { n: 4, el: stack('clipShapes') },
      { n: 5, el: { css: '.dock-tab[data-tab="console"]' }, at: 'tr' },
    ],
  });
}

async function captureRibbon(ctx) {
  await ctx.shot('f03-onoff', {
    crop: { union: [{ ...RB, section: 'On/Off' }, { ...RB, section: 'Helper' }, { ...RB, section: 'Cut Dir' }] },
    marks: [
      { n: 1, el: { ...RB, text: 'Enable' } },
      { n: 2, el: { ...RB, section: 'Helper', text: 'Box' } },
      { n: 3, el: { ...RB, section: 'Cut Dir', text: 'Flip' } },
    ],
  });
  await ctx.shot('f03-gizmo', {
    crop: { el: { ...RB, section: 'Gizmo Mode' } },
    marks: [
      { n: 1, el: { ...RB, text: 'None' } },
      { n: 2, el: { ...RB, section: 'Gizmo Mode', text: 'Move' } },
      { n: 3, el: { ...RB, section: 'Gizmo Mode', text: 'Rotate' } },
      { n: 4, el: { ...RB, section: 'Gizmo Mode', text: 'Scale' } },
      { n: 5, el: { ...RB, text: '6 Axis' } },
    ],
  });
  await ctx.shot('f03-boxsize', {
    crop: { el: { ...RB, section: 'Box Size' } },
    marks: [
      { n: 1, el: { ...RB, text: 'Fit Sel' } },
      { n: 2, el: { ...RB, text: 'Fit Sel +Off.' } },
      { n: 3, el: { ...RB, text: 'Focus On Set' } },
      { n: 4, el: { ...RB, text: 'Fit Scene' } },
      { n: 5, el: { ...RB, section: 'Box Size', css: 'input' } },
    ],
  });
  await ctx.shot('f03-resize', {
    crop: { union: [{ ...RB, section: 'Resize (Main)' }, { ...RB, section: 'Step' }] },
    marks: [
      { n: 1, el: { ...RB, text: 'L+' } },
      { n: 2, el: { ...RB, text: 'L−' } },
      { n: 3, el: { ...RB, section: 'Step', css: 'input' } },
    ],
  });
  await ctx.shot('f03-move', {
    crop: { union: [{ ...RB, section: 'Move (Main)' }, { ...RB, section: 'Additional' }] },
    marks: [
      { n: 1, el: { ...RB, section: 'Move (Main)', text: 'L' } },
      { n: 2, el: { ...RB, text: 'Shapes' } },
    ],
  });
}

async function captureShapes(ctx) {
  await ctx.shot('f03-shapes-empty', { crop: { panel: 'clipShapes', fit: true } });

  // a hole: a sphere fitted to one loudspeaker, grown by 2 m, then inverted
  await select(ctx, '/SX-HA86-013A');
  await waitSel(ctx, 'count', 1);
  await ctx.click({ ...COMMON, text: 'Sphere' });
  await ctx.click({ ...CS, section: 'Sphere 1', tooltip: 'Fit the selection (or scene) + 2 m' });
  await ctx.click({ ...CS, section: 'Sphere 1', tooltip: 'Invert' });
  // a cylinder fitted to another loudspeaker, armed for the gizmo
  await select(ctx, '/SX-HA86-011A');
  await waitSel(ctx, 'count', 1);
  await ctx.click({ ...COMMON, text: 'Cylinder' });
  await ctx.click({ ...CS, section: 'Cylinder 1', tooltip: 'Arm the viewport gizmo' });
  await unselect(ctx);
  await ctx.section('clipShapes', 'Sphere 1', false);

  await ctx.shot('f03-shapes-common', {
    crop: { el: COMMON },
    marks: [
      { n: 1, el: { ...COMMON, text: 'Sphere' } },
      { n: 2, el: { ...COMMON, text: 'Cylinder' } },
      { n: 3, el: { ...COMMON, text: 'Box' } },
      { n: 4, el: { ...COMMON, text: 'Save…' } },
      { n: 5, el: { ...COMMON, text: 'Load…' } },
      { n: 6, el: { ...COMMON, text: 'Delete all' } },
      { n: 7, el: { ...COMMON, text: 'Hide all' } },
      { n: 8, el: { ...COMMON, text: 'Hide main box' } },
      { n: 9, el: { ...COMMON, text: 'Helpers' } },
      { n: 10, el: { ...COMMON, text: 'Gizmo' } },
      { n: 11, el: { ...COMMON, text: '6 Axis' } },
    ],
  });
  const ROW = { ...CS, section: 'Cylinder 1' };
  await ctx.shot('f03-shape-row', {
    crop: { el: ROW },
    marks: [
      { n: 1, el: { ...ROW, css: 'input', nth: 0 } },
      { n: 2, el: { ...ROW, tooltip: 'Disable this shape' }, at: 'bl' },
      { n: 3, el: { ...ROW, tooltip: 'Invert' }, at: 'tr' },
      { n: 4, el: { ...ROW, tooltip: "Show this shape's outline" }, at: 'bl' },
      { n: 5, el: { ...ROW, tooltip: 'Arm the viewport gizmo' }, at: 'tr' },
      { n: 6, el: { ...ROW, tooltip: 'Delete this shape' }, at: 'br' },
      { n: 7, el: { ...ROW, tooltip: 'Fit the selection (or scene) exactly' } },
      { n: 8, el: { ...ROW, tooltip: 'Fit the selection (or scene) + 2 m' } },
      { n: 9, el: { ...ROW, tooltip: 'Move to the selection' } },
      { n: 10, el: { ...ROW, text: 'Center', nth: 1 } },
      { n: 11, el: { ...ROW, text: 'Radius' } },
      { n: 12, el: { ...ROW, text: 'Axis' } },
    ],
  });
  await ctx.shot('f03-shapes-list', { crop: { panel: 'clipShapes', fit: true } });
}

async function f03Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await layout(ctx, 3);
  await ctx.widen('clipShapes', PANEL_W);

  // the box fitted around the public-address loudspeakers, 2 m extra each side
  await select(ctx, '/HA-TELE-PA');
  await waitSel(ctx, 'count', 1);
  await ctx.click({ ...RB, text: 'Fit Sel +Off.' });
  await ctx.click({ ...RB, section: 'Gizmo Mode', text: 'Scale' });
  await unselect(ctx);
  await view(ctx, 135, -35);
  await captureLayout(ctx);
  await ctx.shot('f03-task-fit-viewport', { crop: 'viewport', gpu: true });

  await select(ctx, '/HA-TELE-PA');
  await waitSel(ctx, 'count', 1);
  await captureRibbon(ctx);
  await ctx.harvest('ribbonClippingBox', {
    rename: {
      'Smaller Fit Sel offset': 'Offset −',
      'Larger Fit Sel offset': 'Offset +',
      'Decrease the clipping-box step': 'Step −',
      'Increase the clipping-box step': 'Step +',
      'Grow the box through its LEFT': 'L+ / R+ / F+ / B+ / Bo+ / T+',
      'Shrink the box through its LEFT': 'L− / R− / F− / B− / Bo− / T−',
      'Move the whole box one step toward LEFT': 'L / R / F / B / Bo / T',
    },
    skip: [
      'Grow the box through its RIGHT',
      'Grow the box through its FRONT',
      'Grow the box through its BACK',
      'Grow the box through its BOT',
      'Grow the box through its TOP',
      'Shrink the box through its RIGHT',
      'Shrink the box through its FRONT',
      'Shrink the box through its BACK',
      'Shrink the box through its BOT',
      'Shrink the box through its TOP',
      'Move the whole box one step toward RIGHT',
      'Move the whole box one step toward FRONT',
      'Move the whole box one step toward BACK',
      'Move the whole box one step toward BOT',
      'Move the whole box one step toward TOP',
    ],
  });
  await unselect(ctx);

  await captureShapes(ctx);
  await ctx.click({ ...CS, section: 'Cylinder 1', tooltip: 'Arm the viewport gizmo' });
  await view(ctx, 135, -35);
  await ctx.shot('f03-task-hole-viewport', { crop: 'viewport', gpu: true });

  await ctx.section('clipShapes', 'Sphere 1', true);
  await ctx.harvest('clipShapes', {
    sectionAlias: { '^(Sphere|Cylinder|Box) \\d': 'Each shape' },
    rename: { 'Disable this shape': 'On / off', 'Invert —': 'Invert', "Show this shape's outline": 'Outline', 'Arm the viewport gizmo': 'Gizmo', 'Delete this shape': 'Delete' },
    extra: [
      { section: 'Each shape', label: 'Name', tooltip: 'The shape’s name in the list. Empty = Sphere / Cylinder / Box.', first: true },
      { section: 'Each shape', label: 'Center (X, Y, Z)', tooltip: 'X, Y, Z of the centre (sphere, box) or of the bottom end (cylinder), in metres.' },
      { section: 'Each shape', label: 'Size (box)', tooltip: 'X, Y, Z distance from the centre to the faces: half the full width, depth and height.' },
      { section: 'Each shape', label: 'Radius (sphere, cylinder)', tooltip: 'Radius in metres.' },
      { section: 'Each shape', label: 'Height (cylinder)', tooltip: 'Length along the axis, in metres.' },
      { section: 'Each shape', label: 'Axis (cylinder)', tooltip: 'Direction of the cylinder: 0, 0, 1 stands it upright.' },
    ],
  });
}

export const scene = { id: 'f03', run: f03Scene };
