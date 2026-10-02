// Guide scene: the Label panel (panel-label.html).
import { LABELS, SAMPLES, PANEL_W, SPEAKERS, flyTo } from './_lib.mjs';

// -----------------------------------------------------------------------------
// Labels
// -----------------------------------------------------------------------------

const LB = { panel: 'labels' };
const IMPORT = { ...LB, section: 'Import tags' };
const STYLE = { ...LB, section: 'Style' };

/** Task: place one label by hand and edit its text. */
async function labelsPlaceByHand(ctx) {
  await ctx.click({ ...LB, tooltip: 'Arm placement' });
  await ctx.shot('labels-new', {
    crop: { el: { ...LB, section: 'Common' } },
    marks: [{ n: 1, el: { ...LB, tooltip: 'Arm placement' } }],
  });
  // the click in the model: place at a real item's anchor (what a pick would return)
  await ctx.eval(async () => {
    const { db } = await import('/src/state/viewer/db.ts');
    const { labelsActions } = await import('/src/state/viewer/labels.actions.ts');
    const { found } = await db.findLabelAnchors(['/SX-HA86-011A'], true);
    labelsActions.placeAt(found[0].center);
  });
  await ctx.sleep(300);
  await ctx.type({ ...LB, section: 'Labels (', css: 'input', nth: 0 }, 'Muster area speaker');
  await ctx.shot('labels-list', {
    crop: { el: { ...LB, section: 'Labels (' } },
    marks: [
      { n: 1, el: { ...LB, tooltip: 'Toggle selected' } },
      { n: 2, el: { ...LB, section: 'Labels (', css: 'input', nth: 0 }, at: 'tr' },
      { n: 3, el: { ...LB, tooltip: 'Move this label' }, at: 'bl' },
      { n: 4, el: { ...LB, tooltip: 'Delete this label' }, at: 'tr' },
      { n: 5, el: { ...LB, section: 'Labels (', css: 'input', nth: 1 }, at: 'bl' },
    ],
  });
  await flyTo(ctx, '/HA-TELE-PA');
  await ctx.shot('labels-new-viewport', { crop: 'viewport', gpu: true });
  await ctx.call(LABELS, 'labelsActions', 'clearAll');
}

/** Task: label a pasted list of tags. */
async function labelsImport(ctx) {
  await ctx.section('labels', 'Import tags');
  await ctx.type({ ...IMPORT, css: 'textarea' }, [...SPEAKERS, '/SX-HA86-099Z'].join('\n'));
  await ctx.click({ ...IMPORT, text: 'Label text without leading /' });
  await ctx.shot('labels-import', {
    crop: { el: IMPORT },
    marks: [
      { n: 1, el: { ...IMPORT, css: 'textarea' } },
      { n: 2, el: { ...IMPORT, text: 'Snap anchor to nearest item' } },
      { n: 3, el: { ...IMPORT, text: 'Label text without leading /' } },
      { n: 4, el: { ...IMPORT, tooltip: 'Resolve tags only' } },
      { n: 5, el: { ...IMPORT, text: 'Append' } },
      { n: 6, el: { ...IMPORT, text: 'Replace' } },
    ],
  });
  await ctx.click({ ...IMPORT, text: 'Append' });
  await ctx.sleep(800);
  await ctx.shot('labels-import-notfound', {
    crop: { el: { ...IMPORT, css: 'textarea' }, pad: 8 },
  });
  await ctx.shot('labels-import-viewport', { crop: 'viewport', gpu: true });
  await ctx.section('labels', 'Import tags', false);
}

/** Task: restyle the labels. */
async function labelsStyle(ctx) {
  await ctx.click({ ...LB, tooltip: 'Select every label' });
  await ctx.section('labels', 'Style');
  await ctx.call(LABELS, 'labelsActions', 'setStyle', { bg: '#ffd43b' });
  await ctx.click({ ...STYLE, text: '3D sphere at the anchor' });
  await ctx.shot('labels-style', {
    crop: { el: STYLE },
    marks: [
      { n: 1, el: { ...STYLE, re: '^Applies to the' } },
      { n: 2, el: { ...STYLE, text: 'Label color' } },
      { n: 3, el: { ...STYLE, text: 'Text color' } },
      { n: 4, el: { ...STYLE, text: '3D sphere at the anchor' } },
      { n: 5, el: { ...STYLE, text: 'Styled text (multiline, **bold** spans)' } },
    ],
  });
  await ctx.shot('labels-style-viewport', { crop: 'viewport', gpu: true });
  await ctx.click({ ...LB, tooltip: 'Clear the label selection' });
  await ctx.section('labels', 'Style', false);
}

/** Task: spread overlapping labels out (and back). */
async function labelsExplode(ctx) {
  await ctx.click({ ...LB, tooltip: 'Fan the labels outward' });
  await ctx.shot('labels-explode', {
    crop: {
      union: [{ ...LB, tooltip: 'Fan the labels outward' }, { ...LB, text: 'Box' }],
      pad: 8,
    },
    marks: [
      { n: 1, el: { ...LB, tooltip: 'Fan the labels outward' } },
      { n: 2, el: { ...LB, tooltip: 'Move every label back' } },
      { n: 3, el: { ...LB, text: 'Circle' } },
    ],
  });
  await ctx.shot('labels-explode-viewport', { crop: 'viewport', gpu: true });
  await ctx.call(LABELS, 'labelsActions', 'implode');
}

/** Task: one viewpoint per label. */
async function labelsToViewpoints(ctx) {
  await ctx.click({ ...LB, tooltip: 'Select every label' });
  await ctx.shot('labels-viewpoints-button', {
    crop: { el: { ...LB, section: 'Common' } },
    marks: [
      { n: 1, el: { ...LB, tooltip: 'Select every label' } },
      { n: 2, el: { ...LB, tooltip: 'Add one viewpoint per selected label' } },
    ],
  });
  await ctx.click({ ...LB, tooltip: 'Add one viewpoint per selected label' });
  await ctx.sleep(1500);
  await ctx.shot('labels-viewpoints-viewer', { crop: { panel: 'viewpointViewer', fit: true } });
}

async function labelsOverview(ctx) {
  await ctx.call(LABELS, 'labelsActions', 'deselectAllLabels');
  await ctx.call(LABELS, 'labelsActions', 'toggleSelect', (await labelIds(ctx))[1]);
  await ctx.shot('labels-overview', {
    crop: { ...LB, fit: true },
    marks: [
      { n: 1, el: { ...LB, tooltip: 'Arm placement' } },
      { n: 2, el: { ...LB, tooltip: 'Hide/show all labels' } },
      { n: 3, el: { ...LB, tooltip: 'Highlight the linked items' } },
      { n: 4, el: { ...LB, tooltip: 'Select every label', nth: 0 } },
      { n: 5, el: { ...LB, tooltip: 'Fan the labels outward' } },
      { n: 6, el: { ...LB, tooltip: 'Save all labels' } },
      { n: 7, el: { ...LB, text: 'Style' } },
      { n: 8, el: { ...LB, text: 'Import tags' } },
      { n: 9, el: { ...LB, section: 'Labels (', css: ':scope > div:nth-child(2) > div', nth: 1 } },
    ],
  });
}

async function labelIds(ctx) {
  return ctx.eval(async () => {
    const { labelsState } = await import('/src/state/viewer/labels.state.ts');
    return labelsState.get().items.map((l) => l.id);
  });
}

async function labelsScene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await ctx.open('ribbonPanels');
  await ctx.shot('labels-open', {
    crop: {
      union: [
        { css: '.dock-tab[data-tab="ribbonPanels"]' },
        { panel: 'ribbonPanels', text: 'Hierarchy' },
        { panel: 'ribbonPanels', text: 'Console' },
        { panel: 'ribbonPanels', text: 'Label' },
      ],
      pad: 8,
    },
    marks: [
      { n: 1, el: { css: '.dock-tab[data-tab="ribbonPanels"]' } },
      { n: 2, el: { panel: 'ribbonPanels', text: 'Label' } },
    ],
  });
  await ctx.open('ribbonHome');
  await ctx.open('labels');
  await ctx.widen('labels', PANEL_W);
  await flyTo(ctx, '/HA-TELE-PA');

  await labelsPlaceByHand(ctx);
  await labelsImport(ctx);
  await labelsOverview(ctx);
  await labelsStyle(ctx);
  await labelsExplode(ctx);

  await ctx.section('labels', 'Style');
  await ctx.section('labels', 'Import tags');
  await ctx.harvest('labels', {
    rename: {
      'Toggle selected': 'Label swatch',
      'Move this label': 'Move label',
      'Delete this label': 'Delete label',
      'Explode the labels onto a circle': 'Circle',
      'Explode the labels onto a rectangle': 'Box',
      'Resolve tags only': 'Store',
      'Smaller label sphere': 'Sphere size −',
      'Bigger label sphere': 'Sphere size +',
      'More translucent label spheres': 'Sphere opacity −',
      'More opaque label spheres': 'Sphere opacity +',
    },
    sectionAlias: { '^Labels \\(': 'Label list' },
    extra: [
      { section: 'Style', label: 'Label color / Text color / Leader line', tooltip: 'Colours for the selected labels — or, with nothing selected, for the next labels you create.' },
      { section: 'Style', label: 'Opacity', tooltip: 'Label background opacity, 0.1–1.' },
      { section: 'Import tags', label: 'Tag list', tooltip: 'Paste tag names, one per line. Names that are not found are written back here.' },
      { section: 'Label list', label: 'Label text', tooltip: 'Edit what the label says. With Styled text on, this is a multi-line box where **bold** works.' },
      { section: 'Label list', label: 'Linked fullname', tooltip: 'The model item the label belongs to. Highlight, viewpoints and duplicate checks use it.' },
    ],
  });
  await ctx.section('labels', 'Style', false);
  await ctx.section('labels', 'Import tags', false);

  await labelsToViewpoints(ctx);
}


export const scene = { id: 'labels', run: labelsScene };
