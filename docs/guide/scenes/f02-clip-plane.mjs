// Guide scene: F2 Clip Plane (f02-clip-plane.html) — the layout, the Clipping
// Plane ribbon group by group, and its tasks. No right-hand panel here.
import { fitView, layout, SAMPLES, select, stack, VIEWER } from './_lib.mjs';

const RB = { panel: 'ribbonClippingPlane' };
const PLANE = '/src/components/panels/ribbon-clipping-plane/ribbonClippingPlane.actions.ts';

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

/** What a click on `fullname` in the 3D view leaves behind: the clicked point
 *  (here the item's centre) that Enable / Center start a plane at. */
async function clickOn(ctx, fullname) {
  await select(ctx, fullname);
  await waitSel(ctx, 'count', 1);
  await ctx.eval(async (mod) => {
    const { getRenderer } = await import(mod);
    const { selectionState } = await import('/src/state/viewer/selection.state.ts');
    const b = selectionState.get().bounds;
    const r = getRenderer();
    if (b && r) {
      r.lastClickWorld = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    }
  }, VIEWER);
  await ctx.call(VIEWER, 'viewerActions', 'clearSelection');
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

/** Labels for the icon-only − / + steppers, keyed by their hotkey description. */
function stepperNames() {
  const out = {};
  const FIELDS = { position: 'Position', step: 'Position Step', el: '°el', az: '°az' };
  for (const axis of ['X', 'Y', 'Z']) {
    for (const [field, name] of Object.entries(FIELDS)) {
      out[`Decrease the ${axis} plane ${field}`] = `${axis} ${name} −`;
      out[`Increase the ${axis} plane ${field}`] = `${axis} ${name} +`;
    }
  }
  return out;
}

const enableBtn = (nth) => ({ ...RB, section: 'On/Off', text: 'Enable', nth });
const flipBtn = (nth) => ({ ...RB, section: 'Flip', text: 'Flip', nth });
const rotateBtn = (nth) => ({ ...RB, section: 'Rotation', text: 'Rotate', nth });

// -----------------------------------------------------------------------------
// shots
// -----------------------------------------------------------------------------

async function captureLayout(ctx) {
  await ctx.shot('f02-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonClippingPlane') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewport') },
      { n: 4, el: { css: '.dock-tab[data-tab="console"]' }, at: 'tr' },
    ],
  });
}

async function captureGroups(ctx) {
  await ctx.shot('f02-onoff', {
    crop: { union: [{ ...RB, section: 'On/Off' }, { ...RB, section: 'Visibility' }] },
    marks: [
      { n: 1, el: { ...RB, section: 'On/Off', text: 'X' } },
      { n: 2, el: enableBtn(0) },
      { n: 3, el: { ...RB, tooltip: 'Show the X plane helper' } },
      { n: 4, el: { ...RB, tooltip: "Show the X plane's transform tool" } },
    ],
  });
  await ctx.shot('f02-position', {
    crop: { union: [{ ...RB, section: 'Position' }, { ...RB, section: 'Position Step' }] },
    marks: [
      { n: 1, el: { ...RB, tooltip: 'Center the Z plane' } },
      { n: 2, el: { ...RB, section: 'Position', css: 'input', nth: 2 } },
      { n: 3, el: { ...RB, section: 'Position Step', css: 'input', nth: 2 } },
    ],
  });
  // rotate mode on the Z plane, so its angle fields are unlocked in the picture
  await ctx.click(rotateBtn(2));
  await ctx.shot('f02-rotation', {
    crop: { union: [{ ...RB, section: 'Flip' }, { ...RB, section: 'Rotation' }, { ...RB, section: 'Reset' }] },
    marks: [
      { n: 1, el: flipBtn(2) },
      { n: 2, el: rotateBtn(2) },
      { n: 3, el: { ...RB, section: 'Rotation', css: 'input', nth: 2 } },
      { n: 4, el: { ...RB, section: 'Rotation', css: 'input', nth: 5 } },
      { n: 5, el: { ...RB, text: 'Reset All' } },
    ],
  });
  await ctx.click(rotateBtn(2));
}

/** Task pictures that only make sense with the 3D view. */
async function captureTasks(ctx) {
  // floor plan: Z plane on (at the scene centre: nothing clicked yet), flipped,
  // seen from straight above
  await view(ctx, 90, -89);
  await ctx.shot('f02-task-plan-viewport', { crop: 'viewport', gpu: true });

  // a vertical section through a clicked point, seen at an angle
  await ctx.click({ ...RB, text: 'Reset All' });
  await clickOn(ctx, '/HA-MECH');
  await ctx.click(enableBtn(1));
  await view(ctx, 135, -25);
  await ctx.shot('f02-task-section-viewport', { crop: 'viewport', gpu: true });

  // the same plane turned with the rotation rings
  await ctx.click(rotateBtn(1));
  await ctx.call(PLANE, 'ribbonClippingPlaneActions', 'setAz', 'y', 60);
  await ctx.shot('f02-task-rotate-viewport', { crop: 'viewport', gpu: true });
  await ctx.click({ ...RB, text: 'Reset All' });
}

async function f02Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await layout(ctx, 2);
  await ctx.click(enableBtn(2));
  await ctx.click(flipBtn(2));
  await view(ctx, 135, -35);
  await captureLayout(ctx);
  await captureGroups(ctx);
  await ctx.harvest('ribbonClippingPlane', { rename: stepperNames() });
  await captureTasks(ctx);
}

export const scene = { id: 'f02', run: f02Scene };
