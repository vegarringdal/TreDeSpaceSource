// Guide scene: the Measurement List panel (panel-measurements.html). The
// measurements are placed through the measuring actions (see
// f06-measurements.mjs) — picking does not work headless.
import { flyTo, layout, PANEL_W, SAMPLES } from './_lib.mjs';
import { measurementId, placeMeasurements } from './f06-measurements.mjs';

const ML = { panel: 'measurements' };
const FILES = { ...ML, section: 'Load & save' };
const CONFIG = { ...ML, section: 'Config' };
const LINE = { ...ML, section: 'Speaker spacing' };
const ANGLE = { ...ML, section: 'Angle 1' };
const MEASURE = '/src/state/viewer/measurements.actions.ts';

/** Every row is a section titled by the measurement's name. */
const ROW_SECTIONS = '^(Speaker spacing|Cable route|Angle 1|Point 1|Height difference)';

async function captureOverview(ctx) {
  await ctx.shot('measurements-overview', {
    crop: { ...ML, fit: true },
    marks: [
      { n: 1, el: FILES },
      { n: 2, el: CONFIG },
      { n: 3, el: { ...ML, css: 'button[aria-expanded]', nth: 2 } },
      { n: 4, el: { ...LINE, css: ':scope > div', nth: 0 } },
      { n: 5, el: { ...LINE, css: ':scope > div', nth: 1 } },
    ],
  });
  await ctx.shot('measurements-files', {
    crop: { el: FILES },
    marks: [
      { n: 1, el: { ...FILES, text: 'Save…' } },
      { n: 2, el: { ...FILES, text: 'Load…' } },
      { n: 3, el: { ...FILES, text: 'Mute all' } },
      { n: 4, el: { ...FILES, text: 'Delete all' } },
    ],
  });
}

async function captureConfig(ctx) {
  await ctx.section('measurements', 'Config');
  await ctx.shot('measurements-config', {
    crop: { el: CONFIG },
    marks: [
      { n: 1, el: { ...CONFIG, css: 'input', nth: 0 } },
      { n: 2, el: { ...CONFIG, text: 'Color' }, at: 'tr' },
      { n: 3, el: { ...CONFIG, css: 'input', nth: 1 } },
      { n: 4, el: { ...CONFIG, text: 'solid' } },
      { n: 5, el: { ...CONFIG, text: 'Spheres on' } },
    ],
  });
  await ctx.section('measurements', 'Config', false);
}

/** The line row with its ΔX/ΔY/ΔZ legs and slope switched on. */
async function captureRows(ctx) {
  const id = await measurementId(ctx, 'Speaker spacing');
  await ctx.call(MEASURE, 'measurementsActions', 'toggleAllAxisLegs', id);
  await ctx.call(MEASURE, 'measurementsActions', 'toggleAxisLabel', id, 2);
  await ctx.call(MEASURE, 'measurementsActions', 'toggleSlopeInLabel', id);
  await ctx.shot('measurements-row', {
    crop: { el: LINE },
    marks: [
      { n: 1, el: { ...LINE, css: 'textarea' } },
      { n: 2, el: { ...LINE, tooltip: 'Show the name/value label' } },
      { n: 3, el: { ...LINE, tooltip: '3D sphere at each point' }, at: 'tr' },
      { n: 4, el: { ...LINE, tooltip: 'No perpendicular' } },
      { n: 5, el: { ...LINE, tooltip: 'Append the slope' }, at: 'tr' },
      { n: 6, el: { ...LINE, tooltip: 'Hide in the viewport' } },
      { n: 7, el: { ...LINE, tooltip: 'Delete this measurement' }, at: 'tr' },
      { n: 8, el: { ...LINE, text: 'XYZ' }, at: 'bl' },
      { n: 9, el: { ...LINE, text: 'X' }, at: 'bl' },
      { n: 10, el: { ...LINE, text: 'XT' }, at: 'bl' },
      { n: 11, el: { ...LINE, text: 'ΣXYZ' }, at: 'bl' },
    ],
  });
  await ctx.shot('measurements-legs-viewport', { crop: 'viewport', gpu: true });
  await ctx.shot('measurements-angle', {
    crop: { el: ANGLE },
    marks: [{ n: 1, el: { ...ANGLE, tooltip: 'Flip to the reflex angle' } }],
  });
}

async function measurementsScene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await layout(ctx, 6);
  await ctx.widen('measurements', PANEL_W);
  await flyTo(ctx, '/HA-TELE-PA');
  await placeMeasurements(ctx);
  await captureOverview(ctx);
  await captureConfig(ctx);
  await captureRows(ctx);

  await ctx.section('measurements', 'Config');
  await ctx.harvest('measurements', {
    rename: {
      'More measurement decimals': 'Decimals +',
      'Fewer measurement decimals': 'Decimals −',
      'Bigger 3D point spheres': 'Sphere size +',
      'Smaller 3D point spheres': 'Sphere size −',
      'More opaque point spheres': 'Sphere opacity +',
      'More translucent point spheres': 'Sphere opacity −',
      'Fill the spheres': 'Solid spheres',
      'Show the name/value label': 'Label',
      '3D sphere at each point': 'Spheres',
      'Show the perpendicular': 'Perpendicular helper',
      'No perpendicular': 'Perpendicular helper',
      'Flip to the reflex angle': 'Reflex angle',
      'Append the slope': 'Slope',
      'Hide in the viewport': 'Show / hide',
      'Show in the viewport': 'Show / hide',
      'Delete this measurement': 'Delete',
    },
    sectionAlias: { [ROW_SECTIONS]: 'Each measurement' },
    extra: [
      { section: 'Config', label: 'Color', tooltip: 'Colour of every measurement’s lines, markers and area fill in the 3D view.' },
      { section: 'Config', label: 'Sphere colour', tooltip: 'Colour of the 3D point spheres.' },
      {
        section: 'Each measurement',
        label: 'Name',
        tooltip: 'The measurement’s name. Enter starts a new line; **bold** works. The row header shows the first line.',
        first: true,
      },
    ],
  });
  await ctx.section('measurements', 'Config', false);
}

export const scene = { id: 'measurements', run: measurementsScene };
