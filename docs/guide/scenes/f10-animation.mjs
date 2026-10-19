// Guide scene: F10 Animation (f10-animation.html) — the layout, the Animation
// ribbon, the Timeline and its toolbar (look, rules and camera tools), the
// Key panel in its states (an object's items among them), the Overlay Editor
// and the floating play bar, on a small animation of three PA loudspeakers
// sliding in, step by step. Motion itself cannot be captured; the page
// describes it.
import { flyTo, layout, PANEL_W, SAMPLES, SPEAKERS, stack } from './_lib.mjs';

const RA = { panel: 'ribbonAnimation' };
const TL = { panel: 'animationTimeline' };
const KP = { panel: 'animation' };
const TOOLBAR = '[aria-label="Timeline toolbar"]';
const VIEWER = '/src/state/viewer/viewer.actions.ts';
const UI = '/src/state/animation/animationUi.actions.ts';
const OBJECTS = '/src/state/animation/objects.actions.ts';
const KEYS = '/src/state/animation/keys.actions.ts';
const POSING = '/src/state/animation/posing.actions.ts';
const PLAYER = '/src/state/animation/player.actions.ts';
const EDITOR = '/src/state/animation/overlayEditor.actions.ts';
/** Seconds between two speakers sliding in, and how long each takes. */
const EVERY_S = 3;
const SLIDE_S = 2;

async function captureLayout(ctx) {
  await layout(ctx, 10);
  await flyTo(ctx, '/HA-TELE-PA');
  await ctx.shot('f10-layout', {
    crop: 'app',
    gpu: 'prefer',
    marks: [
      { n: 1, el: stack('ribbonAnimation') },
      { n: 2, el: stack('hierarchy') },
      { n: 3, el: stack('viewport') },
      { n: 4, el: stack('animationTimeline') },
      { n: 5, el: stack('animation') },
    ],
  });
  await ctx.shot('f10-ribbon', {
    crop: { panel: 'ribbonAnimation' },
    marks: [
      { n: 1, el: { ...RA, text: 'Animate' } },
      { n: 2, el: { ...RA, text: 'New' } },
      { n: 3, el: { ...RA, text: 'Video' } },
      { n: 4, el: { ...RA, text: 'Timeline' } },
      { n: 5, el: { ...RA, text: 'Motion paths' } },
      { n: 6, el: { ...RA, text: 'Overlays' } },
      { n: 7, el: { ...RA, text: 'Camera keys' } },
      { n: 8, el: { ...RA, text: 'Undo' } },
    ],
  });
}

/** Three speakers sliding in from above, one step each, a camera key, the
 *  rest of the model hidden but the speaker frame, a label on the first. */
async function buildAnimation(ctx) {
  await ctx.call(UI, 'animationUiActions', 'enterAuthoring');
  await ctx.sleep(600);
  // the Timeline's controls, before rows of keys and bars fill it
  await ctx.harvest('animationTimeline', { skip: ['Make this the current row', 'Edit this overlay'] });
  await ctx.eval(async (names, every, slide) => {
    const { viewerActions } = await import('/src/state/viewer/viewer.actions.ts');
    const { objectsActions } = await import('/src/state/animation/objects.actions.ts');
    const { playerActions } = await import('/src/state/animation/player.actions.ts');
    const { stepsActions } = await import('/src/state/animation/steps.actions.ts');
    const { keysActions } = await import('/src/state/animation/keys.actions.ts');
    const { calloutsActions } = await import('/src/state/animation/callouts.actions.ts');
    for (const [i, name] of names.entries()) {
      await viewerActions.selectByFullnames([name]);
      const id = await objectsActions.fromSelection({ key: false });
      playerActions.seek(i * every);
      objectsActions.slideIn(id, { dir: [0, 0, 1], distance: 1.5, duration: slide, interp: 'smooth' });
      const step = stepsActions.addAtSlider();
      if (step) {
        stepsActions.update(step, { name: `Speaker ${i + 1}`, text: `Lower **${name.slice(1)}** onto its bracket.` });
        stepsActions.setSpan(step, i * every, i * every + slide + 0.5);
      }
    }
    playerActions.seek(0);
    keysActions.keyCamera();
    await viewerActions.selectByFullnames([names[0]]);
    await calloutsActions.addForSelection();
    await viewerActions.clearSelection();
  }, SPEAKERS.slice(0, 3), EVERY_S, SLIDE_S);
  await ctx.sleep(800);
}

/** Timeline height for its own shot: every scene row and the three objects. */
const TIMELINE_SHOT_H = 455;

async function captureTimeline(ctx) {
  await ctx.heighten('animationTimeline', TIMELINE_SHOT_H);
  await ctx.call(UI, 'animationUiActions', 'set', { view: { pxPerSec: 70, offset: 0 } });
  await ctx.call(PLAYER, 'playerActions', 'seek', 3.6);
  await ctx.call(UI, 'animationUiActions', 'setCurrent', null);
  await ctx.sleep(600);
  await ctx.shot('f10-toolbar', {
    crop: { css: TOOLBAR },
    marks: [
      { n: 1, el: { within: TOOLBAR, tooltip: 'The scene you work on' } },
      { n: 2, el: { within: TOOLBAR, text: 'Object' } },
      { n: 3, el: { within: TOOLBAR, tooltip: 'Move gizmo' } },
      { n: 4, el: { within: TOOLBAR, text: 'Key' } },
      { n: 5, el: { within: TOOLBAR, tooltip: 'Delete the picked keys' } },
      { n: 6, el: { within: TOOLBAR, tooltip: 'Time slider to the previous key' } },
      { n: 7, el: { within: TOOLBAR, tooltip: 'Auto-key: every gizmo drag keys at the time slider straight away (red frame)' } },
      { n: 8, el: { within: TOOLBAR, text: 'Colour' } },
      { n: 9, el: { within: TOOLBAR, text: 'Rules' } },
      { n: 10, el: { within: TOOLBAR, text: 'Overlay ▾' } },
      { n: 11, el: { within: TOOLBAR, text: 'Camera' } },
      { n: 12, el: { within: TOOLBAR, tooltip: 'Time slider to the start' } },
      { n: 13, el: { within: TOOLBAR, tooltip: 'Loop' } },
      { n: 14, el: { within: TOOLBAR, tooltip: 'Snap to keys' } },
      { n: 15, el: { within: TOOLBAR, tooltip: 'Export: a video, step stills or the brief for AI' } },
    ],
  });
  await ctx.shot('f10-timeline', {
    crop: { panel: 'animationTimeline' },
    marks: [
      { n: 1, el: { ...TL, text: 'Steps' } },
      // the row's label — the toolbar's Camera button comes first
      { n: 2, el: { ...TL, text: 'Camera', nth: 1 } },
      { n: 3, el: { ...TL, text: 'Colour rules' } },
      { n: 4, el: { ...TL, text: 'Overlays' } },
      { n: 5, el: { ...TL, re: '^Objects \\(' } },
      { n: 6, el: { ...TL, text: SPEAKERS[0].slice(1), nth: 0 } },
      { n: 7, el: { ...TL, text: 'Hidden' } },
    ],
  });
}

async function captureKeyPanel(ctx) {
  await ctx.widen('animation', PANEL_W);
  // an object row picked, posed but not keyed: the next key
  await ctx.call(VIEWER, 'viewerActions', 'selectByFullnames', [SPEAKERS[1]]);
  await ctx.call(PLAYER, 'playerActions', 'seek', 5.5);
  await ctx.sleep(400);
  await ctx.call(POSING, 'posingActions', 'setPoseValues', { move: [0.4, 0, 0] });
  await ctx.sleep(600);
  await ctx.shot('f10-next-key', {
    crop: { panel: 'animation' },
    marks: [
      { n: 1, el: { ...KP, text: 'Key', nth: 0 } },
      { n: 2, el: { ...KP, text: 'Time' } },
      { n: 3, el: { ...KP, text: 'Arrives' } },
      { n: 4, el: { ...KP, text: 'Discard' } },
      { n: 5, el: { ...KP, re: '^From the time slider on' } },
      { n: 6, el: { ...KP, section: 'Object' } },
      { n: 7, el: { ...KP, section: 'Items' } },
      { n: 8, el: { ...KP, section: 'Slide in' } },
    ],
  });
  await ctx.harvest('animation', { key: 'animationObject' });
  await ctx.call(POSING, 'posingActions', 'discardPose');
  // a key picked
  await ctx.eval(async () => {
    const { animationDocState } = await import('/src/state/animation/animationDoc.state.ts');
    const { keysActions } = await import('/src/state/animation/keys.actions.ts');
    const o = animationDocState.get().doc.scenes[0].objects[1];
    keysActions.pickKeys(`o:${o.id}`, [2]);
  });
  await ctx.sleep(600);
  await ctx.shot('f10-key', {
    crop: { panel: 'animation' },
    marks: [
      { n: 1, el: { ...KP, text: 'Time' } },
      { n: 2, el: { ...KP, text: 'Move' } },
      { n: 3, el: { ...KP, text: 'Arrives' } },
      { n: 4, el: { ...KP, text: 'Spin into this key' } },
      { n: 5, el: { ...KP, text: 'Visible' } },
      { n: 6, el: { ...KP, tooltip: 'Delete this key' }, at: 'tr' },
      { n: 7, el: { ...KP, text: 'Offset' } },
    ],
  });
  await ctx.harvest('animation', { key: 'animationKey' });
  // the first step picked
  await ctx.eval(async () => {
    const { animationDocState } = await import('/src/state/animation/animationDoc.state.ts');
    const { animationUiActions } = await import('/src/state/animation/animationUi.actions.ts');
    animationUiActions.pick({ kind: 'step', id: animationDocState.get().doc.scenes[0].steps[0].id });
  });
  await ctx.sleep(600);
  await ctx.shot('f10-step', {
    crop: { panel: 'animation' },
    marks: [
      { n: 1, el: { ...KP, text: 'Name' } },
      { n: 2, el: { ...KP, text: 'Start' } },
      { n: 3, el: { ...KP, text: 'Pause at the end' } },
      { n: 4, el: { ...KP, text: 'Card' } },
    ],
  });
  await ctx.harvest('animation', { key: 'animationStep' });
  // the Colour rules row
  await ctx.call(UI, 'animationUiActions', 'pick', { kind: 'none' });
  await ctx.call(UI, 'animationUiActions', 'setCurrent', '@rules');
  await ctx.eval(async () => {
    const { rulesEditorState } = await import('/src/state/animation/rulesEditor.state.ts');
    const keep = { op: 'append', mode: 'contains', value: 'sx-', comment: '', level: 0 };
    rulesEditorState.set({
      mode: 'hide',
      rules: [{ comment: 'The speakers', enabled: true, filters: [keep], color: '#f59e0b', opacity: 1, store: '' }],
    });
  });
  await ctx.sleep(600);
  await ctx.shot('f10-rules', { crop: { panel: 'animation' } });
  await ctx.harvest('animation', { key: 'animationRules' });
  // the draft not keyed: dropped without a toast in later shots
  await ctx.eval(async () => {
    const { clearPending } = await import('/src/state/animation/runtime.ts');
    const { animationUiState } = await import('/src/state/animation/animationUi.state.ts');
    clearPending();
    animationUiState.set({ previewRules: false });
  });
  // a camera key picked, then the callout: reference tables only
  await ctx.call(KEYS, 'keysActions', 'pickKeys', '@camera', [0]);
  await ctx.sleep(400);
  await ctx.harvest('animation', { key: 'animationCamera' });
  await ctx.eval(async () => {
    const { animationDocState } = await import('/src/state/animation/animationDoc.state.ts');
    const { animationUiActions } = await import('/src/state/animation/animationUi.actions.ts');
    const c = animationDocState.get().doc.scenes[0].callouts[0];
    animationUiActions.pick({ kind: 'callout', id: c.id, keys: [] });
  });
  await ctx.sleep(400);
  await ctx.harvest('animation', { key: 'animationOverlay' });
  await ctx.call(UI, 'animationUiActions', 'pick', { kind: 'none' });
  await ctx.call(UI, 'animationUiActions', 'setCurrent', null);
  await ctx.sleep(400);
  await ctx.shot('f10-scene', { crop: { panel: 'animation' } });
  await ctx.harvest('animation', { key: 'animationScene' });
}

async function captureOverlayEditor(ctx) {
  await ctx.call(EDITOR, 'overlayEditorActions', 'editComponent', 'preset.stepCard');
  await ctx.sleep(600);
  await ctx.shot('f10-overlay-editor', {
    crop: { union: [stack('overlayPreview'), stack('overlayEditor')] },
    marks: [
      { n: 1, el: { panel: 'overlayEditor', text: 'Library' } },
      { n: 2, el: { panel: 'overlayEditor', section: 'Outline' } },
      { n: 3, el: { panel: 'overlayEditor', text: 'Preview' } },
      { n: 4, el: stack('overlayPreview') },
    ],
  });
  await ctx.harvest('overlayEditor', { key: 'overlayEditor' });
  await ctx.harvest('overlayPreview', { key: 'overlayPreview' });
  await ctx.open('animation');
  await ctx.open('animationTimeline');
}

/** Present (ALT+F2): the 3D view with the floating play bar, paused in the
 *  second step. */
async function capturePlayBar(ctx) {
  await ctx.harvest('ribbonAnimation');
  await layout(ctx, 14);
  await ctx.eval(async () => {
    const { animationDocState } = await import('/src/state/animation/animationDoc.state.ts');
    const { playerActions } = await import('/src/state/animation/player.actions.ts');
    playerActions.gotoStep(animationDocState.get().doc.scenes[0].steps[1].id);
  });
  await ctx.sleep(800);
  await ctx.shot('f10-playbar', {
    crop: { css: '[aria-label="Animation play bar"]' },
    marks: [
      { n: 1, el: { within: '[aria-label="Animation play bar"]', re: '^2/3' } },
      { n: 2, el: { within: '[aria-label="Animation play bar"]', tooltip: 'Previous step' } },
      { n: 3, el: { within: '[aria-label="Animation play bar"]', css: 'input[type="range"]' } },
      { n: 4, el: { within: '[aria-label="Animation play bar"]', text: 'Camera keys' } },
      { n: 5, el: { within: '[aria-label="Animation play bar"]', text: 'Close' } },
    ],
  });
  await layout(ctx, 10);
}

async function f10Scene(ctx) {
  await ctx.loadSamples(SAMPLES);
  await captureLayout(ctx);
  await buildAnimation(ctx);
  await captureTimeline(ctx);
  await captureKeyPanel(ctx);
  await captureOverlayEditor(ctx);
  await capturePlayBar(ctx);
  await ctx.call(UI, 'animationUiActions', 'exitMode');
}

export const scene = { id: 'f10', run: f10Scene };
