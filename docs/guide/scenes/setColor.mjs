// Guide scene: the Set Color panel (panel-set-color.html).
import { MC, VIEWER, SAMPLES, PANEL_W, rule, setRules, choose, fitView, flyTo } from './_lib.mjs';

// -----------------------------------------------------------------------------
// Set Color
// -----------------------------------------------------------------------------

const SC = { panel: 'multiColor' };
const RULE1 = { ...SC, section: '#1' };

async function setColorOverview(ctx) {
  await setRules(ctx, 'reset', [
    rule('Ghost everything', [{ value: '' }], { opacity: 0.15 }),
    rule('Piping', [{ value: 'HA-PIPE', level: 2 }], { color: '#ff8800' }),
    rule('Safety', [{ value: 'HA-SAFE', level: 2 }], { color: '#e03131' }),
  ]);
  await ctx.call(MC, 'multiColorActions', 'run');
  await ctx.call(MC, 'multiColorActions', 'collapseAll');
  await ctx.call(MC, 'multiColorActions', 'toggleCollapsed', 1);
  await ctx.shot('setcolor-overview', {
    crop: { ...SC, fit: true },
    marks: [
      { n: 1, el: { ...SC, tooltip: 'Reset model — clears' } },
      { n: 2, el: { ...SC, tooltip: 'Add a new rule' } },
      { n: 3, el: { ...SC, tooltip: 'Run all enabled rules' } },
      { n: 4, el: { ...SC, tooltip: 'Save the rule set' } },
      { n: 5, el: { ...SC, tooltip: 'Load a rule set' } },
      { n: 6, el: { ...SC, tooltip: 'Delete every rule' } },
      { n: 7, el: { ...SC, tooltip: 'Unhide all + reset' } },
      { n: 8, el: { ...SC, text: '#1 Ghost everything' } },
      { n: 9, el: { ...SC, section: '#2', css: 'div.rounded.border' } },
    ],
  });
  await fitView(ctx);
  await ctx.shot('setcolor-ghost-viewport', { crop: 'viewport', gpu: true });

  await ctx.call(MC, 'multiColorActions', 'collapseAll');
  await ctx.shot('setcolor-ghost-rules', {
    crop: { union: [{ ...SC, section: '#1' }, { ...SC, section: '#3' }], pad: 4 },
    marks: [
      { n: 1, el: { ...SC, section: '#1', re: '^\\d+ matched$' } },
      { n: 2, el: { ...SC, tooltip: 'Move this rule up', nth: 2 } },
      { n: 3, el: { ...SC, tooltip: 'Enable / disable', nth: 0 } },
    ],
  });
  await ctx.call(MC, 'multiColorActions', 'toggleCollapsed', 1);
}

/** Task: colour one system — the whole edit → run loop on a pristine rule. */
async function setColorOneSystem(ctx) {
  await setRules(ctx, 'reset', [rule('', [{ value: '' }])]);
  await ctx.type({ ...RULE1, css: 'input[placeholder="Rule Name"]' }, 'Piping');
  await ctx.click({ ...RULE1, text: 'Custom' });
  await ctx.shot('setcolor-one-color', {
    crop: { el: RULE1 },
    marks: [
      { n: 1, el: { ...RULE1, css: 'input[placeholder="Rule Name"]' } },
      { n: 2, el: { ...RULE1, text: 'Custom' } },
      { n: 3, el: { ...RULE1, text: '#ff8800' } },
    ],
  });

  await ctx.type({ ...RULE1, css: 'input[placeholder^="Text the name must contain"]' }, 'HA-PIPE');
  await choose(ctx, 'multiColor', 'The filter is applied', 'Lvl 2');
  await ctx.shot('setcolor-one-level', {
    crop: { el: { ...RULE1, css: 'div.rounded.border' }, pad: 14 },
    marks: [
      { n: 1, el: { ...RULE1, css: 'div.rounded.border input', nth: 0 }, at: 'bl' },
      { n: 2, el: { ...SC, tooltip: 'Contains: name contains' } },
      { n: 3, el: { ...SC, tooltip: 'The filter is applied' }, at: 'tr' },
    ],
  });

  await ctx.click({ ...SC, tooltip: 'Run all enabled rules' });
  await ctx.sleep(500);
  await ctx.shot('setcolor-one-run', {
    crop: { union: [{ ...SC, section: 'Common' }, { ...SC, text: '#1 Piping' }] },
    marks: [
      { n: 1, el: { ...SC, tooltip: 'Run all enabled rules' } },
      { n: 2, el: { ...SC, re: '^\\d+ matched$' } },
    ],
  });
  await fitView(ctx);
  await ctx.shot('setcolor-one-viewport', { crop: 'viewport', gpu: true });
}

/** Task: show only what matches (Hide model mode). */
async function setColorHideModel(ctx) {
  await setRules(ctx, 'reset', [rule('Escape routes', [{ value: 'HA-SAFE-ESCAPEROUTE' }], { color: '#2f9e44' })]);
  await ctx.click({ ...SC, tooltip: 'Reset model — clears' });
  await ctx.shot('setcolor-hide-mode', {
    crop: { union: [{ ...SC, tooltip: 'Reset model — clears' }, { within: '[role="listbox"]' }], pad: 8 },
    marks: [{ n: 1, el: { within: '[role="listbox"]', text: 'Hide model' } }],
  });
  await ctx.click({ within: '[role="listbox"]', text: 'Hide model' });
  await ctx.call(MC, 'multiColorActions', 'run');
  await fitView(ctx);
  await ctx.shot('setcolor-hide-viewport', { crop: 'viewport', gpu: true });
}

/** Task: take a name from the model with the + button. */
async function setColorPickName(ctx) {
  await setRules(ctx, 'reset', [rule('Detectors', [{ value: '' }], { color: '#f08c00' })]);
  await ctx.open('hierarchy');
  await ctx.call(VIEWER, 'viewerActions', 'select', '/HA-SAFE-DETECTOR');
  await ctx.sleep(800);
  await ctx.shot('setcolor-pick-tree', {
    crop: { union: [{ css: '.dock-tab[data-tab="hierarchy"]' }, { panel: 'hierarchy', text: '/HA-TELE' }], pad: 8 },
    marks: [{ n: 1, el: { panel: 'hierarchy', text: '/HA-SAFE-DETECTOR' } }],
  });
  await ctx.click({ ...SC, tooltip: 'Insert the LAST selected name' });
  await ctx.shot('setcolor-pick-row', {
    crop: { el: { ...RULE1, css: 'div.rounded.border' } },
    marks: [
      { n: 2, el: { ...SC, tooltip: 'Insert the LAST selected name' } },
      { n: 3, el: { ...RULE1, css: 'div.rounded.border input', nth: 0 } },
    ],
  });
}

/** Task: paste a list of names, each with its own colour (Multi). */
async function setColorMulti(ctx) {
  await setRules(ctx, 'reset', [rule('Loudspeakers', [{ mode: 'multi', value: '' }], { color: '#1c7ed6' })]);
  await ctx.type(
    { ...RULE1, css: 'textarea' },
    '/SX-HA86-011A red\n/SX-HA86-012A red\n/SX-HA86-013A\n/SX-HA86-015A #2f9e44',
  );
  await ctx.call(MC, 'multiColorActions', 'run');
  await ctx.sleep(400);
  await ctx.shot('setcolor-multi', {
    crop: { el: RULE1 },
    marks: [
      { n: 1, el: { ...SC, tooltip: 'Contains: name contains' } },
      { n: 2, el: { ...RULE1, css: 'textarea' }, at: 'br' },
      { n: 3, el: { ...RULE1, text: '#1c7ed6' } },
    ],
  });
  await flyTo(ctx, '/HA-TELE-PA');
  await ctx.shot('setcolor-multi-viewport', { crop: 'viewport', gpu: true });
}

/** Task: combine filter rows — Append, then Keep, then Remove. */
async function setColorCombine(ctx) {
  await setRules(ctx, 'reset', [
    rule(
      'PA speakers, A side',
      [
        { value: 'HA-TELE-PA', level: 3, comment: 'everything in the PA system' },
        { op: 'keep', mode: 'starts', value: '/SX-', comment: 'only the loudspeakers' },
        { op: 'remove', mode: 'ends', value: 'B', comment: 'drop the B-side units' },
      ],
      { color: '#ae3ec9' },
    ),
  ]);
  await ctx.call(MC, 'multiColorActions', 'run');
  await ctx.sleep(400);
  await ctx.shot('setcolor-combine', {
    crop: { el: RULE1 },
    marks: [
      { n: 1, el: { ...SC, tooltip: 'Append adds', nth: 0 } },
      { n: 2, el: { ...SC, tooltip: 'Append adds', nth: 1 } },
      { n: 3, el: { ...SC, tooltip: 'Append adds', nth: 2 } },
      { n: 4, el: { ...SC, re: '^\\d+ matched$' } },
    ],
  });
}

async function setColorScene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await ctx.open('ribbonPanels');
  await ctx.shot('setcolor-open', {
    crop: {
      union: [
        { css: '.dock-tab[data-tab="ribbonPanels"]' },
        { panel: 'ribbonPanels', text: 'Hierarchy' },
        { panel: 'ribbonPanels', text: 'Console' },
        { panel: 'ribbonPanels', text: 'Set Color' },
      ],
      pad: 8,
    },
    marks: [
      { n: 1, el: { css: '.dock-tab[data-tab="ribbonPanels"]' } },
      { n: 2, el: { panel: 'ribbonPanels', text: 'Set Color' } },
    ],
  });
  await ctx.open('ribbonHome');
  await ctx.open('multiColor');
  await ctx.widen('multiColor', PANEL_W);

  await setColorOverview(ctx);
  await ctx.harvest('multiColor', {
    rename: {
      'Reset model — clears': 'Run mode',
      'Insert a new rule BEFORE': 'Insert rule above',
      'Move this rule up': 'Move rule up',
      'Move this rule down': 'Move rule down',
      'Delete this rule': 'Delete rule',
      'Expand all rules': 'Expand all',
      'Collapse all rules': 'Collapse all',
      'Append adds this row': 'Filter operation',
      'Insert a new filter row BEFORE': 'Insert filter row above',
      'Move this filter row up': 'Move filter row up',
      'Move this filter row down': 'Move filter row down',
      'Remove this filter row': 'Remove filter row',
      'Insert the LAST selected name': 'Insert selected name',
      'Contains: name contains': 'Match type',
      'The filter is applied to the NAMES': 'Hierarchy level',
      'Scope this rule to models': 'Store',
      'Quick set: opacity 0': 'Opacity 0',
      'Quick set: opacity 1': 'Opacity 1',
      'Enable / disable this rule': 'On / Off',
    },
    sectionAlias: { '^#\\d': 'Each rule', '': 'Rules list' },
    extra: [
      { section: 'Each rule', label: 'Rule name', tooltip: 'Free text shown in the rule header — use it to say what the rule is for.' },
      { section: 'Each rule', label: 'Opacity', tooltip: '0–1. 1 leaves the opacity alone; lower values make the matched items see-through.' },
      { section: 'Each rule', label: 'Value', tooltip: 'The text the names are matched against (see Match type). Blank matches everything.' },
      { section: 'Each rule', label: 'Comment', tooltip: 'A note for this filter row; it does not affect the result.' },
    ],
  });

  await setColorOneSystem(ctx);
  await setColorHideModel(ctx);
  await setColorPickName(ctx);
  await setColorMulti(ctx);
  await setColorCombine(ctx);
}


export const scene = { id: 'setColor', run: setColorScene };
