// Guide scene: F6 Measurements (f06-measurements.html) — the layout, the
// Measurement ribbon group by group, the in-progress bar and the measuring
// tasks. The Measurement List panel on the right is documented in
// panel-measurements.html. Picking does not work headless, so measurements are
// placed through the same actions a click uses, on points taken from real
// items (the PA loudspeakers' top faces).
import { flyTo, layout, PANEL_W, SAMPLES, SPEAKERS, stack } from './_lib.mjs';

const RB = { panel: 'ribbonMeasurements' };
const RIBBON = '/src/components/panels/ribbon-measurements/ribbonMeasurements.actions.ts';
const MEASURE = '/src/state/viewer/measurements.actions.ts';

// -----------------------------------------------------------------------------
// shared helpers (also used by panel-measurements.mjs)
// -----------------------------------------------------------------------------

/** Place a realistic set of measurements: for each one, arm its tool on the
 *  ribbon, add the points a click would add, and finish — the same actions
 *  the viewport calls. Points are the top-face centres of the loudspeakers
 *  (normal straight up), so they sit on real geometry. `which` picks the
 *  kinds to create; names are set like a user typing them into the list. */
export async function placeMeasurements(ctx, which = ['line', 'path', 'angle', 'point', 'face']) {
  await ctx.eval(
    async (speakers, kinds, ribbonPath, measurePath) => {
      const { db } = await import('/src/state/viewer/db.ts');
      const { ribbonMeasurementsActions: rm } = await import(ribbonPath);
      const { measurementsActions: ma } = await import(measurePath);
      const { measurementsState } = await import('/src/state/viewer/measurements.state.ts');
      const tops = [];
      for (const n of speakers) {
        const b = await db.boundsForNames([n]);
        tops.push({
          point: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]],
          normal: [0, 0, 1],
          kind: 'face',
        });
      }
      const plans = {
        line: { hits: [tops[0], tops[1]], name: 'Speaker spacing' },
        path: { hits: [tops[0], tops[1], tops[2], tops[3]], name: 'Cable route' },
        angle: { hits: [tops[0], tops[2], tops[4]], name: '' },
        point: { hits: [tops[4]], name: '' },
        face: { hits: [tops[1], tops[3]], name: 'Height difference' },
      };
      for (const kind of kinds) {
        const plan = plans[kind];
        rm.setTool(kind);
        for (const h of plan.hits) {
          ma.addPoint(h);
        }
        ma.finish();
        const items = measurementsState.get().items;
        if (plan.name) {
          ma.setLabel(items[items.length - 1].id, plan.name);
        }
      }
      rm.setTool('off');
    },
    SPEAKERS,
    which,
    RIBBON,
    MEASURE,
  );
  await ctx.sleep(300);
}

/** Id of the measurement whose list name is `label` (or kind label). */
export async function measurementId(ctx, label) {
  return ctx.eval(async (l) => {
    const { measurementsState, displayName } = await import('/src/state/viewer/measurements.state.ts');
    return measurementsState.get().items.find((m) => displayName(m) === l)?.id ?? null;
  }, label);
}

// -----------------------------------------------------------------------------
// layout + ribbon groups
// -----------------------------------------------------------------------------

async function captureLayout(ctx) {
  await ctx.shot('f06-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonMeasurements') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewport') },
      { n: 4, el: stack('measurements') },
      { n: 5, el: { css: '.dock-tab[data-tab="console"]' }, at: 'tr' },
    ],
  });
}

async function captureGroups(ctx) {
  await ctx.call(RIBBON, 'ribbonMeasurementsActions', 'setTool', 'line');
  await ctx.shot('f06-tools', {
    crop: { el: { ...RB, section: 'Measure Tool' } },
    marks: ['Off', 'Point', 'Line', 'Path', 'Area', 'Diameter', 'Angle', 'Face'].map((text, i) => ({
      n: i + 1,
      el: { ...RB, section: 'Measure Tool', text },
    })),
  });
  await ctx.shot('f06-lock', {
    crop: { union: [{ ...RB, section: 'Options' }, { ...RB, section: 'Lock' }] },
    marks: [
      { n: 1, el: { ...RB, text: 'Auto Disable' } },
      { n: 2, el: { ...RB, text: 'None' } },
      { n: 3, el: { ...RB, text: 'Perpendicular' } },
      { n: 4, el: { ...RB, text: 'Parallel' } },
      { n: 5, el: { ...RB, text: 'X-axis' }, at: 'tr' },
    ],
  });
  await ctx.shot('f06-snapping', {
    crop: { union: [{ ...RB, section: 'Snapping' }, { ...RB, section: 'List' }] },
    marks: [
      { n: 1, el: { ...RB, text: 'Snap' } },
      { n: 2, el: { ...RB, text: 'Seams' } },
      { n: 3, el: { ...RB, text: 'Corners' } },
      { n: 4, el: { ...RB, text: 'Edges' } },
      { n: 5, el: { ...RB, section: 'Snapping', css: 'input', nth: 0 }, at: 'bl' },
      { n: 6, el: { ...RB, section: 'Snapping', css: 'input', nth: 1 }, at: 'br' },
      { n: 7, el: { ...RB, section: 'List', text: 'List' } },
    ],
  });
  await ctx.call(RIBBON, 'ribbonMeasurementsActions', 'setTool', 'off');
}

// -----------------------------------------------------------------------------
// tasks
// -----------------------------------------------------------------------------

/** The on-canvas bar while a Path has two points down. */
async function captureBar(ctx) {
  const BAR = { panel: 'viewport', css: 'div:has(> button[title^="Remove the last point"])' };
  await ctx.eval(
    async (speakers, ribbonPath, measurePath) => {
      const { db } = await import('/src/state/viewer/db.ts');
      const { ribbonMeasurementsActions: rm } = await import(ribbonPath);
      const { measurementsActions: ma } = await import(measurePath);
      rm.setTool('path');
      for (const n of speakers.slice(0, 2)) {
        const b = await db.boundsForNames([n]);
        ma.addPoint({
          point: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]],
          normal: [0, 0, 1],
          kind: 'face',
        });
      }
    },
    SPEAKERS,
    RIBBON,
    MEASURE,
  );
  await ctx.sleep(300);
  await ctx.shot('f06-bar', {
    crop: { el: BAR, pad: 10 },
    marks: [
      { n: 1, el: { ...BAR, css: 'span', nth: 0 } },
      { n: 2, el: { panel: 'viewport', css: 'button[title^="Finish this measurement"]' } },
      { n: 3, el: { panel: 'viewport', css: 'button[title^="Remove the last point"]' } },
      { n: 4, el: { panel: 'viewport', css: 'button[title^="Discard this measurement"]' } },
    ],
  });
  await ctx.shot('f06-task-path-viewport', { crop: 'viewport', gpu: true });
  await ctx.call(MEASURE, 'measurementsActions', 'cancel');
  await ctx.call(RIBBON, 'ribbonMeasurementsActions', 'setTool', 'off');
}

async function captureTasks(ctx) {
  await ctx.shot('f06-task-line-viewport', { crop: 'viewport', gpu: true });
  await ctx.shot('f06-list', { crop: { panel: 'measurements', fit: true } });
}

async function f06Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await layout(ctx, 6);
  await ctx.widen('measurements', PANEL_W);
  await flyTo(ctx, '/HA-TELE-PA');
  await placeMeasurements(ctx);
  await ctx.section('measurements', 'Load & save', false);
  await captureLayout(ctx);
  await captureGroups(ctx);
  await captureTasks(ctx);
  await captureBar(ctx);
  await ctx.harvest('ribbonMeasurements', {
    rename: {
      'Wider corner snap radius': 'Corner radius +',
      'Tighter corner snap radius': 'Corner radius −',
      'Wider edge snap radius': 'Edge radius +',
      'Tighter edge snap radius': 'Edge radius −',
    },
  });
}

export const scene = { id: 'f06', run: f06Scene };
