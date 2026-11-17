// Guide scene: F5 Transform (f05-transform.html) — the layout, the Transform
// ribbon group by group, the Transform Objects panel and the tasks.
import { flyTo, layout, SAMPLES, select, stack } from './_lib.mjs';

const RB = { panel: 'ribbonSelectionTransform' };
const TO = { panel: 'transformObjects' };
const FILES = { ...TO, section: 'Objects & files' };
const GROUP = '/HA-TELE-PA';
const GROUP_NAME = 'HA-TELE-PA';
const SPEAKER = '/SX-HA86-011A';
const SPEAKER_NAME = 'SX-HA86-011A';
const OBJECT_GROUP = { ...RB, section: 'Object' };

/** Wait (up to 10 s) until the transform objects store answers `test` (the
 *  name of a check below): the object list, the current object and the
 *  history counts update asynchronously, and the ribbon buttons read them to
 *  decide whether they are greyed out. */
async function waitTransform(ctx, test, arg) {
  const isReady = await ctx.eval(
    async (t, a) => {
      const { transformState } = await import('/src/state/transform/transform.state.ts');
      const checks = {
        objects: (s) => s.objects.length >= a,
        current: (s) => s.objects.find((o) => o.id === s.currentId)?.name === a,
        undo: (s) => s.undoDepth >= a,
        redo: (s) => s.redoDepth >= a,
      };
      for (let i = 0; i < 100; i++) {
        if (checks[t](transformState.get())) {
          return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    },
    test,
    arg,
  );
  if (!isReady) {
    throw new Error(`docs-shots: transform objects never reached ${test} ${arg}`);
  }
}

/** Select `fullname` and make it a transform object (the ribbon's button). */
async function newObject(ctx, fullname, name) {
  await select(ctx, fullname);
  await ctx.click({ ...RB, text: 'New Object' });
  await waitTransform(ctx, 'current', name);
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
      { n: 5, el: stack('transformObjects') },
    ],
  });
}

async function captureGroups(ctx) {
  await ctx.shot('f05-object', {
    crop: { el: OBJECT_GROUP },
    marks: [{ n: 1, el: { ...RB, text: 'New Object' } }],
  });
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

/** The Transform Objects panel: the container closed, its sub-object open. */
async function capturePanel(ctx) {
  await ctx.section('transformObjects', GROUP_NAME, false);
  await ctx.section('transformObjects', SPEAKER_NAME, true);
  const row = { ...TO, section: SPEAKER_NAME };
  // a row's header bar is the first child of its section
  const header = (name) => ({ ...TO, section: name, css: ':scope > div', nth: 0 });
  await ctx.shot('f05-panel', {
    crop: { ...TO, fit: true },
    marks: [
      { n: 1, el: FILES },
      { n: 2, el: header(GROUP_NAME) },
      { n: 3, el: header(SPEAKER_NAME) },
      { n: 4, el: { ...row, tooltip: 'Select this object' } },
      { n: 5, el: { ...row, tooltip: 'Moved along X' } },
      { n: 6, el: { ...row, tooltip: 'What Move, Rotate and Scale are about' } },
      { n: 7, el: { ...row, tooltip: 'The object this one rides on' } },
      { n: 8, el: { ...row, text: 'Add selection' }, at: 'bl' },
    ],
  });
}

async function f05Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await layout(ctx, 5);
  // the speakers' group as a container, one loudspeaker inside it as its
  // sub-object — the loudspeaker is the current object from here on
  await newObject(ctx, GROUP, GROUP_NAME);
  await newObject(ctx, SPEAKER, SPEAKER_NAME);
  await flyTo(ctx, GROUP);
  await ctx.click({ ...RB, section: 'On/Off', text: 'Move' });
  await captureLayout(ctx);
  await captureGroups(ctx);

  // lift the loudspeaker two steps, take one back: Undo and Redo both live
  await waitTransform(ctx, 'undo', 2);
  await ctx.click({ ...RB, section: 'Move', text: 'T' });
  await waitTransform(ctx, 'undo', 3);
  await ctx.click({ ...RB, section: 'Move', text: 'T' });
  await waitTransform(ctx, 'undo', 4);
  await ctx.click({ ...RB, text: 'Undo' });
  await waitTransform(ctx, 'redo', 1);
  await ctx.shot('f05-history', {
    crop: { union: [{ ...RB, section: 'Reset' }, { ...RB, section: 'Objects' }, { ...RB, section: 'History' }] },
    marks: [
      { n: 1, el: { ...RB, text: 'Reset Obj' } },
      { n: 2, el: { ...RB, section: 'Reset', text: 'Reset All' } },
      { n: 3, el: { ...RB, section: 'Objects', text: 'List' } },
      { n: 4, el: { ...RB, text: 'Undo' } },
      { n: 5, el: { ...RB, text: 'Redo' } },
    ],
  });
  await ctx.shot('f05-task-move-viewport', { crop: 'viewport', gpu: true });
  await capturePanel(ctx);

  await ctx.click({ ...RB, section: 'On/Off', text: 'Rotate' });
  await ctx.shot('f05-task-rotate-viewport', { crop: 'viewport', gpu: true });

  await ctx.harvest('ribbonSelectionTransform', {
    rename: { 'Decrease the transform step': 'Step −', 'Increase the transform step': 'Step +' },
    extra: [
      {
        section: 'Pivot',
        label: 'Lock',
        tooltip: "Shown while placing the pivot: keep this position — it becomes the object's pivot.",
        keys: 'ALT 127',
      },
      {
        section: 'Pivot',
        label: 'Cancel',
        tooltip: 'Shown while placing the pivot: discard this placement — the pivot stays where it was.',
        keys: 'ALT 128',
      },
      {
        section: 'Pivot',
        label: 'Item Pivot',
        tooltip: 'Shown while placing the pivot: while on, click an item in the 3D view to move the pivot to its centre.',
        keys: 'ALT 122',
      },
    ],
  });
  await ctx.click({ ...FILES, text: 'Delete all' });
}

export const scene = { id: 'f05', run: f05Scene };
