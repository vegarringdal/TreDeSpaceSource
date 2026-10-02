// Guide scene: F10 Viewpoint (f10-viewpoint.html) — the layout, the Viewpoint
// Editor and Viewpoint Viewer panels, and the three "(viewpoint)" editors.
// The Home ribbon is documented in f01-home.html. Viewpoints are built through
// the app's actions (picking does not work headless): fly to a Huldra system,
// Add viewpoint, then name / describe / fill it.
import { LABELS, PANEL_W, SAMPLES, SPEAKERS, flyTo, layout, rule, stack } from './_lib.mjs';

const VP = '/src/state/viewer/viewpoints.actions.ts';
const VE = { panel: 'viewpoints' };
const VV = { panel: 'viewpointViewer' };
const LV = { panel: 'labelsViewpoint' };
const SV = { panel: 'multiColorViewpoint' };
const DIALOG = { css: 'body > .fixed.inset-0 > div' };

const PA = 'PA loudspeakers';
const ESCAPE = 'Escape routes';
const PIPING = 'Piping overview';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Id of the viewpoint called `name`. */
async function vpId(ctx, name) {
  return ctx.eval(async (n) => {
    const { viewpointsState } = await import('/src/state/viewer/viewpoints.state.ts');
    return viewpointsState.get().list.find((v) => v.name === n)?.id ?? null;
  }, name);
}

/** Fly to `fullname`, press Add viewpoint, then name and describe the new one. */
async function addViewpointAt(ctx, fullname, name, description, fullnames = []) {
  await flyTo(ctx, fullname);
  await ctx.call(VP, 'viewpointsActions', 'addViewpoint');
  const id = await ctx.eval(async () => {
    const { viewpointsState } = await import('/src/state/viewer/viewpoints.state.ts');
    return viewpointsState.get().activeId;
  });
  await ctx.call(VP, 'viewpointsActions', 'setName', id, name);
  await ctx.call(VP, 'viewpointsActions', 'setDescription', id, description);
  await ctx.call(VP, 'viewpointsActions', 'setFullnames', id, fullnames.join('\n'));
  await ctx.sleep(300);
}

async function activate(ctx, name) {
  await ctx.call(VP, 'viewpointsActions', 'activate', await vpId(ctx, name));
  await ctx.sleep(600);
}

/** A Line measurement between two items' label anchors (what two clicks would give). */
async function measureBetween(ctx, a, b) {
  await ctx.eval(
    async (na, nb) => {
      const { db } = await import('/src/state/viewer/db.ts');
      const { measurementsActions } = await import('/src/state/viewer/measurements.actions.ts');
      const { found } = await db.findLabelAnchors([na, nb], true);
      measurementsActions.setTool('line');
      for (const f of found) {
        measurementsActions.addPoint({ point: f.center, normal: [0, 0, 1], kind: 'face' });
      }
      measurementsActions.finish();
      measurementsActions.setTool(null);
    },
    a,
    b,
  );
  await ctx.sleep(300);
}

// -----------------------------------------------------------------------------
// state
// -----------------------------------------------------------------------------

async function buildViewpoints(ctx) {
  await addViewpointAt(
    ctx,
    '/HA-SAFE-ESCAPEROUTE',
    ESCAPE,
    '**Escape routes** on the platform.\nCheck that every route is free of equipment.',
    ['/HA-SAFE-ESCAPEROUTE'],
  );
  await addViewpointAt(
    ctx,
    '/HA-TELE-PA',
    PA,
    'Public address loudspeakers at the muster area.\n**Check:** every speaker is labelled.',
    SPEAKERS,
  );
  await addViewpointAt(ctx, '/HA-PIPE', PIPING, 'All piping, seen from above.');
}

/** Give the PA viewpoint labels, a measurement and colour rules — the Edit →
 *  change → Save to viewpoint round trip. */
async function fillPaViewpoint(ctx) {
  await activate(ctx, PA);
  await ctx.click({ ...LV, text: 'Edit' });
  await ctx.call(LABELS, 'labelsActions', 'importTags', SPEAKERS.join('\n'), 'append');
  await measureBetween(ctx, SPEAKERS[0], SPEAKERS[1]);
  await ctx.call(
    VP,
    'viewpointRulesActions',
    'loadFromText',
    JSON.stringify({
      version: 1,
      mode: 'reset',
      rules: [
        rule('Ghost everything', [{ value: '' }], { opacity: 0.15 }),
        rule('PA system', [{ value: 'HA-TELE-PA', level: 3 }], { color: '#ff8800' }),
      ],
    }),
  );
  await ctx.click({ ...LV, text: 'Save to viewpoint' });
  await activate(ctx, PA);
}

// -----------------------------------------------------------------------------
// shots
// -----------------------------------------------------------------------------

async function captureLayout(ctx) {
  await ctx.shot('f10-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonHome') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewpointViewer') },
      { n: 4, el: stack('viewport') },
      { n: 5, el: stack('viewpoints') },
      { n: 6, el: stack('measurementsViewpoint') },
      { n: 7, el: stack('multiColorViewpoint') },
      { n: 8, el: stack('labelsViewpoint') },
    ],
  });
}

async function captureEditor(ctx) {
  const row = { ...VE, section: PA };
  await ctx.call(VP, 'viewpointsActions', 'select', null);
  await ctx.sleep(300);
  await ctx.shot('f10-editor', {
    crop: { ...VE, fit: true },
    marks: [
      { n: 1, el: { ...VE, text: 'Add viewpoint' } },
      { n: 2, el: { ...VE, text: 'Save' } },
      { n: 3, el: { ...VE, text: 'Load' } },
      { n: 4, el: { ...VE, text: 'Delete all' } },
      { n: 5, el: { ...VE, section: ESCAPE, css: 'button[aria-expanded]' } },
      { n: 6, el: { ...row, css: 'button[aria-expanded]' } },
    ],
  });
  await ctx.call(VP, 'viewpointsActions', 'select', await vpId(ctx, PA));
  await ctx.sleep(300);
  await ctx.shot('f10-row-head', {
    crop: {
      union: [{ ...row, css: 'button[aria-expanded]' }, { ...row, tooltip: 'Move this viewpoint down' }, { ...row, text: 'Delete' }],
      pad: 6,
    },
    marks: [
      { n: 1, el: { ...row, css: '[data-tooltip^="Labels · Measurements"]' }, at: 'bl' },
      { n: 2, el: { ...row, tooltip: 'Insert a NEW empty viewpoint' }, at: 'bl' },
      { n: 3, el: { ...row, tooltip: 'Move this viewpoint up' } },
      { n: 4, el: { ...row, tooltip: 'Move this viewpoint down' }, at: 'tr' },
      { n: 5, el: { ...row, text: 'Activate' } },
      { n: 6, el: { ...row, text: 'Update camera/clip' } },
      { n: 7, el: { ...row, text: 'Delete' } },
    ],
  });
  await ctx.shot('f10-row-content', {
    crop: { union: [{ ...row, css: 'input' }, { ...row, text: 'From selection' }], pad: 6 },
    marks: [
      { n: 1, el: { ...row, css: 'input' } },
      { n: 2, el: { ...row, css: 'textarea', nth: 0 } },
      { n: 3, el: { ...row, text: 'Copy labels' } },
      { n: 4, el: { ...row, text: 'Copy measurements' } },
      { n: 5, el: { ...row, text: 'Copy set colors' } },
      { n: 6, el: { ...row, css: 'textarea', nth: 1 } },
      { n: 7, el: { ...row, text: 'From selection' } },
    ],
  });
}

async function captureViewer(ctx) {
  await ctx.shot('f10-viewer', {
    crop: { ...VV, fit: true },
    marks: [
      { n: 1, el: { ...VV, text: 'Load' } },
      { n: 2, el: { ...VV, text: 'Mute labels' } },
      { n: 3, el: { ...VV, text: 'Mute measures' } },
      { n: 4, el: { ...VV, text: PA } },
      { n: 5, el: { ...VV, css: '.leading-relaxed' } },
    ],
  });
}

async function captureSetColor(ctx) {
  await ctx.call(VP, 'viewpointRulesActions', 'collapseAll');
  await ctx.shot('f10-setcolor', {
    crop: { ...SV, fit: true },
    marks: [
      { n: 1, el: { ...SV, re: '^Rules of' } },
      { n: 2, el: { ...SV, text: 'Edit' } },
      { n: 3, el: { ...SV, tooltip: 'Run all enabled rules' } },
    ],
  });
}

/** The scene↔viewpoint mute: the normal Label panel while a viewpoint is
 *  live, and Label (viewpoint) after Unmute scene. */
async function captureMute(ctx) {
  await ctx.open('labels');
  await ctx.shot('f10-scene-muted', {
    crop: { panel: 'labels', fit: true },
    marks: [{ n: 1, el: { panel: 'labels', text: 'Unmute scene' } }],
  });
  await ctx.click({ panel: 'labels', text: 'Unmute scene' });
  await ctx.close('labels');
  await ctx.shot('f10-viewpoint-muted', {
    crop: { ...LV, fit: true },
    marks: [{ n: 1, el: { ...LV, text: 'Unmute viewpoint' } }],
  });
  await ctx.click({ ...LV, text: 'Unmute viewpoint' });
}

/** Locked → Edit → unsaved edits → the prompt when switching away (Discard). */
async function captureEditFlow(ctx) {
  await ctx.shot('f10-edit-locked', {
    crop: { union: [{ ...LV, re: '^Viewing' }, { ...LV, text: 'Edit' }, { ...LV, section: 'Common' }], pad: 4 },
    marks: [
      { n: 1, el: { ...LV, re: '^Viewing' } },
      { n: 2, el: { ...LV, text: 'Edit' } },
    ],
  });
  await ctx.click({ ...LV, text: 'Edit' });
  await ctx.call(LABELS, 'labelsActions', 'explode');
  await ctx.sleep(300);
  await ctx.shot('f10-edit-dirty', {
    crop: { union: [{ ...LV, re: '^Editing' }, { ...LV, text: 'Save to viewpoint' }, { ...LV, section: 'Common' }], pad: 4 },
    marks: [
      { n: 1, el: { ...LV, text: 'unsaved edits' } },
      { n: 2, el: { ...LV, text: 'Save to viewpoint' } },
    ],
  });
  const target = await vpId(ctx, ESCAPE);
  await ctx.eval(async (id) => {
    const { viewpointsActions } = await import('/src/state/viewer/viewpoints.actions.ts');
    void viewpointsActions.activate(id);
  }, target);
  await ctx.sleep(500);
  await ctx.shot('f10-unsaved', {
    crop: { el: DIALOG, pad: 10 },
    marks: [
      { n: 1, el: { within: DIALOG.css, text: 'Save' } },
      { n: 2, el: { within: DIALOG.css, text: 'Discard' } },
    ],
  });
  // the same as clicking Discard (a synthetic click on the modal did not register headless)
  await ctx.call('/src/components/dialogs/dialogs.actions.ts', 'dialogs', 'resolveConfirm', false);
  await ctx.sleep(800);
}

async function captureViewports(ctx) {
  await activate(ctx, PA);
  await ctx.shot('f10-task-pa-viewport', { crop: 'viewport', gpu: true });
  await activate(ctx, ESCAPE);
  await ctx.shot('f10-task-escape-viewport', { crop: 'viewport', gpu: true });
}

async function harvestPanels(ctx) {
  await ctx.call(VP, 'viewpointsActions', 'select', await vpId(ctx, PA));
  await ctx.sleep(300);
  await ctx.harvest('viewpoints', {
    rename: {
      'Insert a NEW empty viewpoint': 'Insert before',
      'Move this viewpoint up': 'Move up',
      'Move this viewpoint down': 'Move down',
      'Labels · Measurements': 'Content badge',
    },
    sectionAlias: { [`^(${ESCAPE}|${PA}|${PIPING})`]: 'Each viewpoint', '': 'Top' },
    extra: [
      { section: 'Each viewpoint', label: 'Name', tooltip: 'The viewpoint name, shown in the list and in the Viewpoint Viewer.' },
      { section: 'Each viewpoint', label: 'Description', tooltip: 'Free text shown under the active viewpoint in the Viewpoint Viewer. **bold** and new lines work.' },
      { section: 'Each viewpoint', label: 'Selected on activation', tooltip: 'Item names, one per line, that are selected when the viewpoint is activated. Empty = nothing selected.' },
    ],
  });
  await ctx.harvest('viewpointViewer', {
    rename: { 'Activate this viewpoint': 'Viewpoint name' },
  });
}

// -----------------------------------------------------------------------------
// scene
// -----------------------------------------------------------------------------

async function f10Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await layout(ctx, 10);
  await buildViewpoints(ctx);
  await fillPaViewpoint(ctx);
  await captureLayout(ctx);

  // room for the editors: wider right-hand columns, and the Viewpoint Editor
  // gets the whole column height
  await ctx.widen('labelsViewpoint', PANEL_W);
  await ctx.widen('viewpoints', PANEL_W);
  await ctx.close('measurementsViewpoint');

  await captureEditFlow(ctx);
  await activate(ctx, PA);
  await captureSetColor(ctx);
  await captureEditor(ctx);
  await captureMute(ctx);
  await captureViewer(ctx);
  await captureViewports(ctx);
  await harvestPanels(ctx);
}

export const scene = { id: 'f10', run: f10Scene };
