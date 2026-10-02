// Guide scene: F5 Transform (f05-transform.html) — the layout, the Transform
// ribbon group by group, and its tasks. No right-hand panel here.
import { flyTo, layout, SAMPLES, select, stack } from './_lib.mjs';

const RB = { panel: 'ribbonSelectionTransform' };
const SPEAKER = '/SX-HA86-011A';

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

async function captureLayout(ctx) {
  await ctx.shot('f05-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonSelectionTransform') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewport') },
      { n: 4, el: { css: '.dock-tab[data-tab="console"]' }, at: 'tr' },
    ],
  });
}

async function captureGroups(ctx) {
  await ctx.shot('f05-gizmo', {
    crop: { union: [{ ...RB, section: 'On/Off' }, { ...RB, section: 'Pivot' }, { ...RB, section: 'Options' }] },
    marks: [
      { n: 1, el: { ...RB, section: 'On/Off', text: 'Move' } },
      { n: 2, el: { ...RB, section: 'On/Off', text: 'Rotate' } },
      { n: 3, el: { ...RB, section: 'On/Off', text: 'Scale' } },
      { n: 4, el: { ...RB, text: 'Set Pivot' } },
      { n: 5, el: { ...RB, section: 'Pivot', text: 'Reset' } },
      { n: 6, el: { ...RB, text: 'Auto Disable' } },
    ],
  });

  await ctx.click({ ...RB, text: 'Set Pivot' });
  await ctx.shot('f05-pivot-setting', {
    crop: { el: { ...RB, section: 'Pivot' } },
    marks: [
      { n: 1, el: { ...RB, text: 'Lock' } },
      { n: 2, el: { ...RB, text: 'Cancel' } },
      { n: 3, el: { ...RB, text: 'Item Pivot' } },
    ],
  });
  await ctx.click({ ...RB, text: 'Cancel' });

  await ctx.shot('f05-step', {
    crop: { union: [{ ...RB, section: 'Quick Move' }, { ...RB, section: 'Step' }] },
    marks: [
      { n: 1, el: { ...RB, text: 'Move To Click' } },
      { n: 2, el: { ...RB, section: 'Step', text: 'cm' } },
      { n: 3, el: { ...RB, section: 'Step', css: 'input' } },
    ],
  });
  await ctx.shot('f05-move', {
    crop: { union: [{ ...RB, section: 'Move' }, { ...RB, section: 'Scale' }, { ...RB, section: 'Rotate' }] },
    marks: [
      { n: 1, el: { ...RB, section: 'Move', text: 'R' } },
      { n: 2, el: { ...RB, text: 'Bigger' } },
      { n: 3, el: { ...RB, text: 'Smaller' } },
      { n: 4, el: { ...RB, text: 'T→F' } },
    ],
  });
}

async function f05Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await layout(ctx, 5);
  await select(ctx, SPEAKER);
  await waitSel(ctx, 'count', 1);
  await flyTo(ctx, '/HA-TELE-PA');
  await ctx.click({ ...RB, section: 'On/Off', text: 'Move' });
  await captureLayout(ctx);
  await captureGroups(ctx);

  // lift the loudspeaker two steps, take one back: Undo and Redo both live
  await ctx.click({ ...RB, section: 'Move', text: 'T' });
  await waitSel(ctx, 'transformUndoDepth', 1);
  await ctx.click({ ...RB, section: 'Move', text: 'T' });
  await waitSel(ctx, 'transformUndoDepth', 2);
  await ctx.click({ ...RB, text: 'Undo' });
  await waitSel(ctx, 'transformRedoDepth', 1);
  await ctx.shot('f05-history', {
    crop: { union: [{ ...RB, section: 'Reset' }, { ...RB, section: 'History' }] },
    marks: [
      { n: 1, el: { ...RB, text: 'Reset Sel' } },
      { n: 2, el: { ...RB, section: 'Reset', text: 'Reset All' } },
      { n: 3, el: { ...RB, text: 'Undo' } },
      { n: 4, el: { ...RB, text: 'Redo' } },
    ],
  });
  await ctx.shot('f05-task-move-viewport', { crop: 'viewport', gpu: true });

  await ctx.click({ ...RB, section: 'On/Off', text: 'Rotate' });
  await ctx.shot('f05-task-rotate-viewport', { crop: 'viewport', gpu: true });

  // the app's Bigger / Smaller tooltips say "percent", but the step is a length
  // (the longest side grows / shrinks by it) — the table states what they do
  await ctx.eval(() => {
    const fix = { Bigger: 'Grow the selection evenly so its longest side gets one step longer', Smaller: 'Shrink the selection evenly so its longest side gets one step shorter' };
    for (const el of document.querySelectorAll('.dock-panel[data-panel="ribbonSelectionTransform"] [data-tooltip]')) {
      const label = el.textContent.trim();
      if (fix[label]) {
        el.dataset.tooltip = fix[label];
      }
    }
  });
  await ctx.harvest('ribbonSelectionTransform', {
    rename: { 'Decrease the transform step': 'Step −', 'Increase the transform step': 'Step +' },
    extra: [
      {
        section: 'Pivot',
        label: 'Lock',
        tooltip: 'Shown while placing the pivot: confirm this pivot position — rotate and scale turn around it.',
      },
      {
        section: 'Pivot',
        label: 'Cancel',
        tooltip: 'Shown while placing the pivot: discard the custom pivot and go back to the selection centre.',
      },
      {
        section: 'Pivot',
        label: 'Item Pivot',
        tooltip: 'Shown while placing the pivot: while on, click an item in the 3D view to move the pivot to its centre.',
        keys: 'ALT 122',
      },
    ],
  });
  await ctx.click({ ...RB, section: 'Reset', text: 'Reset All' });
}

export const scene = { id: 'f05', run: f05Scene };
