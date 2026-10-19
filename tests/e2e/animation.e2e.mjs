// Animation end-to-end scenarios (run by scripts/anim-e2e.mjs — npm run
// test:anim). Each starts from a clean authoring state (animProbe.reset) and
// drives the app through the actions its buttons and hotkeys call; `t.near`
// / `t.equal` / `t.check` collect what is not as expected.

const SPK = ['/SX-HA86-011A', '/SX-HA86-012A', '/SX-HA86-013A'];
const POSING = '/src/state/animation/posing.actions.ts';
const OBJECTS = '/src/state/animation/objects.actions.ts';
const KEYS = '/src/state/animation/keys.actions.ts';
const STEPS = '/src/state/animation/steps.actions.ts';
const CALLOUTS = '/src/state/animation/callouts.actions.ts';
const SCENES = '/src/state/animation/scenes.actions.ts';
const UI = '/src/state/animation/animationUi.actions.ts';
const PLAYER = '/src/state/animation/player.actions.ts';
const DOC = '/src/state/animation/animationDoc.actions.ts';
const TIMELINE = '/src/components/panels/animation-timeline/timelineEdit.actions.ts';
const ITEMS = '/src/state/animation/objectItems.actions.ts';
const QUICK = '/src/state/animation/quickRules.actions.ts';
/** A Set Color rule keeping the speakers (their names hold `sx-`). */
const KEEP_SX = {
  comment: 'keep',
  enabled: true,
  filters: [{ op: 'append', mode: 'contains', value: 'sx-', comment: '', level: 0 }],
  color: null,
  opacity: 1,
  store: '',
};
/** The speakers' group (46 nodes, 242 items). */
const GROUP = '/HA-TELE-PA';

/** Key (I) and let the frame settle. */
async function key(t) {
  await t.call(POSING, 'posingActions', 'key');
  await t.probe('settle');
}

/** The first object of the scene. */
const firstObject = async (t) => (await t.probe('objects'))[0];

/** Set the view's azimuth as if the user had turned the camera. */
async function turnView(t, azimuth) {
  await t.eval(async (a) => {
    const { runtimeRenderer } = await import('/src/state/animation/runtime.ts');
    const { captureCameraPose, setCameraPose } = await import('/src/state/animation/runtimeCamera.ts');
    const { playerActions } = await import('/src/state/animation/player.actions.ts');
    playerActions.userTookCamera();
    const r = runtimeRenderer();
    setCameraPose(r, { ...captureCameraPose(r), azimuth: a });
  }, azimuth);
  await t.probe('settle');
}

/** An object of SPK[0] with keys at 0 (rest) and at 2 (+2 m in x). */
async function twoKeys(t) {
  await t.probe('select', [SPK[0]]);
  await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: true });
  await t.probe('settle');
  await t.probe('seek', 2);
  await t.probe('drag', 2);
  await key(t);
}

export const SCENARIOS = [
  {
    name: '+ Object: the selection as an object with a key where it stands, named after its node',
    async run(t) {
      await t.probe('select', [SPK[0]]);
      await t.probe('seek', 1);
      await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: true });
      await t.probe('settle');
      const objects = await t.probe('objects');
      t.equal(objects.length, 1, 'one object');
      t.equal(objects[0]?.name, SPK[0].slice(1), 'named after the node');
      t.equal(objects[0]?.keys, [{ t: 1, move: [0, 0, 0], interp: 'smooth' }], 'a key at the time slider, at rest');
      t.equal((await t.probe('ui')).current, `o:${objects[0]?.id}`, 'its row is the current row');
      await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: true });
      t.equal((await t.probe('objects')).length, 1, 'the same items reuse the object');
      t.check((await t.probe('panelText', 'animationTimeline')).includes(SPK[0].slice(1)), 'its row is in the Timeline');
    },
  },
  {
    name: 'posing: a drag only poses; Key keys at the time slider; scrubbing drops a pose not keyed',
    async run(t) {
      await t.probe('select', [SPK[0]]);
      const g0 = await t.probe('gizmo');
      await t.probe('drag', 2);
      t.check((await t.probe('ui')).posing?.length === 1, 'posing the selection’s (new) object');
      t.near(await t.probe('pose', SPK[0]), [2, 0, 0], 'the pose is drawn');
      t.near((await t.probe('gizmo'))?.[0] - g0?.[0], 2, 'the gizmo sits on the posed items');
      t.equal((await firstObject(t))?.keys.length, 0, 'nothing keyed yet');
      await key(t);
      t.equal((await firstObject(t))?.keys, [{ t: 0, move: [2, 0, 0], interp: 'smooth' }], 'Key keyed the pose at 0');
      t.equal((await t.probe('ui')).posing, null, 'the pose is keyed');
      await t.probe('seek', 2);
      await t.probe('drag', 0, 0, 1);
      t.near(await t.probe('pose', SPK[0]), [2, 0, 1], 'posed at 2');
      await t.probe('seek', 3);
      t.equal((await t.probe('ui')).posing, null, 'moving the time slider dropped the pose');
      t.near(await t.probe('pose', SPK[0]), [2, 0, 0], 'back where the keys have it');
      await t.probe('drag', 0, 0, 1);
      await key(t);
      t.equal((await firstObject(t))?.keys.map((k) => k.t), [0, 3], 'keys at 0 and 3');
      await t.probe('seek', 1.5);
      const z = (await t.probe('pose', SPK[0]))?.[2] ?? 0;
      t.check(z > 0 && z < 1, `it moves between the keys (z ${z})`);
    },
  },
  {
    name: 'picking a key puts the time slider on it; posing there and Key replaces it',
    async run(t) {
      await twoKeys(t);
      const o = await firstObject(t);
      await t.call(KEYS, 'keysActions', 'pickKeys', `o:${o.id}`, [0]);
      await t.probe('settle');
      t.near(await t.probe('time'), 0, 'the time slider jumps to the key');
      await t.probe('drag', 0, 1);
      await key(t);
      const keys = (await firstObject(t)).keys;
      t.equal(keys.length, 2, 'still two keys');
      t.near(keys[0].move, [0, 1, 0], 'the key holds the new pose');
    },
  },
  {
    name: 'the Key panel: typed values pose the next key; Time carries the pose; Discard drops it',
    async run(t) {
      await t.probe('select', [SPK[0]]);
      await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: true });
      await t.probe('settle');
      t.check((await t.probe('panelText', 'animation')).includes('Next key'), 'the Key panel shows the next key');
      await t.call(POSING, 'posingActions', 'setPoseValues', { move: [0, 0, 3] });
      await t.probe('settle');
      t.near(await t.probe('pose', SPK[0]), [0, 0, 3], 'typed values pose it');
      await t.call(POSING, 'posingActions', 'movePoseTo', 2);
      await t.probe('settle');
      t.near(await t.probe('time'), 2, 'Time moves the slider');
      t.near(await t.probe('pose', SPK[0]), [0, 0, 3], 'and takes the pose along');
      await t.call(POSING, 'posingActions', 'setNextInterp', 'hold');
      await key(t);
      t.equal((await firstObject(t)).keys[1], { t: 2, move: [0, 0, 3], interp: 'hold' }, 'keyed at 2, holding');
      await t.probe('drag', 5);
      await t.call(POSING, 'posingActions', 'discardPose');
      await t.probe('settle');
      t.near(await t.probe('pose', SPK[0]), [0, 0, 3], 'Discard put it back');
    },
  },
  {
    name: 'instant keys: hide, show and colour from here hold until a later key',
    async run(t) {
      await twoKeys(t);
      const o = await firstObject(t);
      await t.probe('seek', 1);
      await t.call(KEYS, 'keysActions', 'instantFromHere', [o.id], { visible: false });
      await t.probe('seek', 1.5);
      await t.call(KEYS, 'keysActions', 'instantFromHere', [o.id], { visible: true, color: '#00ff00' });
      await t.probe('seek', 1.2);
      t.equal(await t.probe('visibleOf', SPK[0]), false, 'hidden from 1');
      await t.probe('seek', 1.8);
      t.equal(await t.probe('visibleOf', SPK[0]), true, 'shown from 1.5');
      t.equal(await t.probe('colorOf', SPK[0]), '#00ff00', 'coloured from 1.5');
      t.near((await t.probe('pose', SPK[0]))?.[0], 1.8, 'the inserted keys keep the movement', 0.15);
      t.equal((await firstObject(t)).keys.map((k) => k.t), [0, 1, 1.5, 2], 'two keys inserted');
    },
  },
  {
    name: 'Slide in: hidden away until the time slider, then into place',
    async run(t) {
      await t.probe('select', [SPK[1]]);
      await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: false });
      await t.probe('settle');
      const o = await firstObject(t);
      await t.probe('seek', 1);
      await t.call(OBJECTS, 'objectsActions', 'slideIn', o.id, { dir: [0, 0, 1], distance: 2, duration: 2, interp: 'smooth' });
      await t.probe('settle', 400);
      t.equal((await firstObject(t)).keys.map((k) => k.t), [0, 1, 3], 'three keys');
      await t.probe('seek', 0.5);
      t.equal(await t.probe('visibleOf', SPK[1]), false, 'hidden before');
      t.near(await t.probe('pose', SPK[1]), [0, 0, 2], 'waiting 2 m above');
      await t.probe('seek', 3.5);
      t.equal(await t.probe('visibleOf', SPK[1]), true, 'shown');
      t.near(await t.probe('pose', SPK[1]), [0, 0, 0], 'in place');
    },
  },
  {
    name: 'camera row: Key the view; the view follows while scrubbing; moving it frees it until Play',
    async run(t) {
      await t.call(UI, 'animationUiActions', 'setCurrent', '@camera');
      await turnView(t, 1);
      await key(t);
      await t.probe('seek', 2);
      await turnView(t, 2);
      await key(t);
      t.equal((await t.probe('scene')).camera, [0, 2], 'two camera keys');
      t.equal((await t.probe('camera')).follow, 'follow', 'Key brings the view back to the keys');
      await t.probe('seek', 1);
      const c = await t.probe('camera');
      t.near(c.frame, 1.5, 'the camera row glides');
      t.near(c.view, 1.5, 'the view follows it');
      await turnView(t, -1);
      await t.probe('seek', 0.5);
      t.equal((await t.probe('camera')).follow, 'free', 'moving the view frees it');
      t.near((await t.probe('camera')).view, -1, 'and the view stays where the user put it');
      await t.call(PLAYER, 'playerActions', 'stop');
      await t.call(PLAYER, 'playerActions', 'play');
      await t.probe('settle', 400);
      await t.call(PLAYER, 'playerActions', 'pause');
      t.equal((await t.probe('camera')).follow, 'follow', 'Play follows the camera keys again');
    },
  },
  {
    name: 'clipping and colour rules rows: Key clips; rules built in the Key panel key from the time slider',
    async run(t) {
      await t.call(UI, 'animationUiActions', 'setCurrent', '@section');
      await key(t);
      t.equal((await t.probe('scene')).section, [0], 'a clipping key');
      t.check((await t.probe('frameInfo')).clip, 'the frame has clipping');
      await t.probe('seek', 1);
      await t.call(UI, 'animationUiActions', 'setCurrent', '@rules');
      await t.eval(async (rule) => {
        const { rulesEditorState } = await import('/src/state/animation/rulesEditor.state.ts');
        rulesEditorState.set({ mode: 'hide', rules: [rule] });
      }, KEEP_SX);
      await t.probe('settle');
      t.equal([(await t.probe('ui')).previewRules, await t.probe('previewLook')], [true, { mode: 'hide', rules: 1 }], 'the draft shows');
      await key(t);
      t.equal((await t.probe('scene')).rules, [{ t: 1, mode: 'hide', rules: 1 }], 'a colour-rules key');
      await t.probe('seek', 0.5);
      t.equal((await t.probe('frameInfo')).look, null, 'no rules before it');
      await t.probe('seek', 1.5);
      t.equal((await t.probe('frameInfo')).look, 'hide', 'the rules from it on');
    },
  },
  {
    name: "Set Color's Run while authoring shows the rules; scrubbing drops them; Key keys them",
    async run(t) {
      await t.eval(async () => {
        const { multiColorState } = await import('/src/components/panels/multi-color/multiColor.state.ts');
        multiColorState.set({
          mode: 'reset',
          rules: [{ comment: '', enabled: true, filters: [{ op: 'append', mode: 'contains', value: 'sx-', comment: '', level: 0 }], color: '#ff0000', opacity: 1, store: '' }],
        });
        const { multiColorActions } = await import('/src/components/panels/multi-color/multiColor.actions.ts');
        await multiColorActions.run();
      });
      await t.probe('settle');
      t.check((await t.probe('ui')).previewRules, 'previewing the rules');
      t.equal((await t.probe('ui')).current, '@rules', 'the Colour rules row is current');
      await t.probe('seek', 1);
      t.check(!(await t.probe('ui')).previewRules, 'scrubbing dropped the preview');
      await t.eval(async () => (await import('/src/components/panels/multi-color/multiColor.actions.ts')).multiColorActions.run());
      await key(t);
      t.equal((await t.probe('scene')).rules.length, 1, 'Key keyed the rules');
      t.check(!(await t.probe('ui')).previewRules, 'the preview is keyed');
    },
  },
  {
    name: 'steps: Key on the Steps row fills to the next step; a pausing step stops playback',
    async run(t) {
      await twoKeys(t);
      await t.call(UI, 'animationUiActions', 'setCurrent', '@steps');
      await t.probe('seek', 3);
      await key(t);
      await t.probe('seek', 0);
      await key(t);
      await t.probe('seek', 1);
      await key(t);
      const steps = (await t.probe('scene')).steps;
      t.equal(steps.map((s) => [s.start, s.end]), [[0, 3], [3, 8]], 'two steps, the new one up to the next; none inside a step');
      await t.call(STEPS, 'stepsActions', 'togglePause', steps[0].id);
      await t.call(PLAYER, 'playerActions', 'stop');
      await t.call(PLAYER, 'playerActions', 'play');
      await t.probe('settle', 3600);
      const p = await t.probe('player');
      t.equal(p.status, 'waiting', 'playback waits at the end of the pausing step');
      t.near(p.time, 3, 'at its end');
      await t.call(PLAYER, 'playerActions', 'continue');
      await t.probe('settle', 400);
      t.equal((await t.probe('player')).status, 'playing', 'Continue goes on');
      await t.call(PLAYER, 'playerActions', 'stop');
      await t.probe('seek', 1);
      t.equal((await t.probe('frameInfo')).overlays, [`step:${steps[0].id}`], 'the step card shows');
    },
  },
  {
    name: 'previous / next step and the step under the time slider',
    async run(t) {
      await t.call(UI, 'animationUiActions', 'setCurrent', '@steps');
      await key(t);
      await t.probe('seek', 6);
      await key(t);
      const [a, b] = (await t.probe('scene')).steps;
      await t.call(PLAYER, 'playerActions', 'gotoStep', a.id);
      await t.probe('settle');
      await t.call(PLAYER, 'playerActions', 'nextStep');
      await t.probe('settle');
      t.near(await t.probe('time'), 6, 'next step');
      t.equal((await t.probe('player')).step, b.id, 'the step at the time slider');
      await t.probe('seek', 7);
      await t.call(PLAYER, 'playerActions', 'prevStep');
      await t.probe('settle');
      t.near(await t.probe('time'), 6, 'previous step goes to the start of the current one first');
      await t.call(PLAYER, 'playerActions', 'prevStep');
      await t.probe('settle');
      t.equal((await t.probe('player')).step, a.id, 'then to the one before');
    },
  },
  {
    name: 'callouts: + Callout hangs from the object; once keyed, a drag keys its place',
    async run(t) {
      await t.probe('select', [SPK[0]]);
      await t.call(CALLOUTS, 'calloutsActions', 'addForSelection');
      await t.probe('settle');
      const [c] = (await t.probe('scene')).callouts;
      t.equal([c?.start, c?.end], [0, 3], 'shown from the time slider for 3 s');
      t.equal((await t.probe('objects')).length, 1, 'the selection became an object');
      t.equal((await t.probe('frameInfo')).overlays.length, 1, 'it is drawn');
      await t.call(CALLOUTS, 'calloutsActions', 'keyHere', c.id);
      await t.probe('seek', 2);
      const inst = await t.eval(async () => {
        const { animationDocState } = await import('/src/state/animation/animationDoc.state.ts');
        return animationDocState.get().doc.overlayInstances[0];
      });
      await t.call(CALLOUTS, 'calloutsActions', 'moveOverlay', inst.id, { ...inst.anchor, offset: [120, -40] });
      t.equal((await t.probe('scene')).callouts[0].keys, 2, 'the drag keyed the place at 2 s');
    },
  },
  {
    name: 'Timeline: dragging a diamond retimes it in one undo step; copy / paste / delete keys',
    async run(t) {
      await twoKeys(t);
      const o = await firstObject(t);
      const id = `k|o:${o.id}|1`;
      await t.call(TIMELINE, 'timelineEditActions', 'movePoints', [id], 0.5, 'drag');
      await t.call(TIMELINE, 'timelineEditActions', 'movePoints', [id], 1, 'drag');
      await t.call(TIMELINE, 'timelineEditActions', 'movePoints', [id], 1, 'end');
      t.equal((await firstObject(t)).keys.map((k) => k.t), [0, 3], 'the key moved by 1 s');
      await t.call(DOC, 'animationDocActions', 'undo');
      t.equal((await firstObject(t)).keys.map((k) => k.t), [0, 2], 'one undo step');
      await t.call(KEYS, 'keysActions', 'pickKeys', `o:${o.id}`, [0, 1]);
      await t.call(KEYS, 'keysActions', 'copyPicked');
      await t.probe('seek', 5);
      await t.call(KEYS, 'keysActions', 'paste');
      t.equal((await firstObject(t)).keys.map((k) => k.t), [0, 2, 5, 7], 'pasted at the time slider');
      await t.call(KEYS, 'keysActions', 'pickKeys', `o:${o.id}`, [2, 3]);
      await t.call(KEYS, 'keysActions', 'deletePicked');
      t.equal((await firstObject(t)).keys.map((k) => k.t), [0, 2], 'deleted');
    },
  },
  {
    name: 'undo of a key puts the object and the gizmo back',
    async run(t) {
      await t.probe('select', [SPK[0]]);
      const g0 = await t.probe('gizmo');
      await t.probe('drag', 3);
      await key(t);
      await t.call(DOC, 'animationDocActions', 'undo');
      await t.probe('settle', 500);
      t.near(await t.probe('pose', SPK[0]), [0, 0, 0], 'back at rest');
      t.near(await t.probe('gizmo'), g0, 'the gizmo with it', 0.05);
    },
  },
  {
    name: 'Auto-key keys every drag straight away',
    async run(t) {
      await t.probe('select', [SPK[0]]);
      await t.call(UI, 'animationUiActions', 'toggleAutoKey');
      await t.probe('seek', 1);
      await t.probe('drag', 1);
      t.equal((await t.probe('ui')).posing, null, 'no pose waits');
      t.equal((await firstObject(t))?.keys, [{ t: 1, move: [1, 0, 0], interp: 'smooth' }], 'keyed at once');
      await t.call(UI, 'animationUiActions', 'toggleAutoKey');
    },
  },
  {
    name: 'a muted object stands at rest; update from selection keeps its keys',
    async run(t) {
      await twoKeys(t);
      const o = await firstObject(t);
      await t.call(OBJECTS, 'objectsActions', 'toggleMuted', o.id);
      await t.probe('seek', 2);
      t.near(await t.probe('pose', SPK[0]), [0, 0, 0], 'muted: at rest');
      await t.call(OBJECTS, 'objectsActions', 'toggleMuted', o.id);
      await t.probe('select', [SPK[2]]);
      await t.call(OBJECTS, 'objectsActions', 'updateFromSelection', o.id);
      await t.probe('settle', 500);
      const after = await firstObject(t);
      t.equal(after.items, [SPK[2].toLowerCase()], 'the new items');
      t.equal(after.keys.length, 2, 'the keys stay');
      t.near(await t.probe('pose', SPK[2]), [2, 0, 0], 'and move the new items');
    },
  },
  {
    name: 'scenes: a new scene is empty and active; switching back shows the first',
    async run(t) {
      await twoKeys(t);
      const first = (await t.probe('scene')).id;
      await t.call(SCENES, 'scenesActions', 'newScene');
      await t.probe('settle', 400);
      t.equal((await t.probe('scene')).scenes, 2, 'two scenes');
      t.equal((await t.probe('objects')).length, 0, 'the new one is empty');
      await t.call(PLAYER, 'playerActions', 'switchScene', first);
      await t.probe('settle', 400);
      t.equal((await t.probe('objects')).length, 1, 'the first has its object');
      await t.probe('seek', 2);
      t.near(await t.probe('pose', SPK[0]), [2, 0, 0], 'and plays it');
    },
  },
  {
    name: 'loop and ping-pong are the scene’s; ping-pong plays back to the start',
    async run(t) {
      await twoKeys(t);
      await t.call(SCENES, 'scenesActions', 'togglePingPong');
      t.check((await t.probe('scene')).pingPong, 'ping-pong on');
      await t.probe('seek', 1.9);
      await t.call(PLAYER, 'playerActions', 'play');
      await t.probe('settle', 600);
      const p = await t.probe('player');
      t.equal(p.direction, -1, 'on the way back');
      t.check(p.time < 2, 'before the end');
      await t.call(PLAYER, 'playerActions', 'stop');
      await t.call(SCENES, 'scenesActions', 'toggleLoop');
      t.check((await t.probe('scene')).loop, 'loop on');
    },
  },
  {
    name: 'files: Save then Open gives the same animation; a v1 file is refused',
    async run(t) {
      await twoKeys(t);
      await t.call(UI, 'animationUiActions', 'setCurrent', '@steps');
      await key(t);
      const same = await t.eval(async () => {
        const { animationDocActions } = await import('/src/state/animation/animationDoc.actions.ts');
        const io = await import('/src/lib/animation/io.ts');
        // key order aside (the parser fills in a design's defaults, so the
        // embedded designs are compared by id)
        const canon = (v) =>
          Array.isArray(v)
            ? v.map(canon)
            : v && typeof v === 'object'
              ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
              : v;
        const plain = (d) => JSON.stringify(canon({ ...d, overlayComponents: d.overlayComponents.map((c) => c.id) }));
        const doc = animationDocActions.docForSave();
        const back = io.parseAnimationDoc(io.serializeAnimationDoc(doc));
        return back.doc ? plain(back.doc) === plain(doc) : back.error;
      });
      t.equal(same, true, 'the round trip keeps everything');
      const report = await t.call(DOC, 'animationDocActions', 'loadFromValue', { format: 'tredespace.animation', version: 1, actors: [], timelines: [] });
      t.check(!report.ok && report.errors[0].includes('version 1'), `v1 refused: ${report.errors[0]}`);
    },
  },
  {
    name: 'host API: listSteps, playStep, gotoStep and getState',
    async run(t) {
      await t.call(UI, 'animationUiActions', 'setCurrent', '@steps');
      await key(t);
      const r = await t.eval(async () => {
        const { animationHandlers } = await import('/src/lib/messageApi/handlersAnimation.ts');
        const list = await animationHandlers['animation.listSteps']({ p: {} });
        const id = list.steps[0].id;
        await animationHandlers['animation.gotoStep']({ p: { id } });
        const state = await animationHandlers['animation.getState']({ p: {} });
        let missing = '';
        try {
          await animationHandlers['animation.playStep']({ p: { id: 'nope' } });
        } catch (e) {
          missing = e.code ?? e.message;
        }
        return { n: list.steps.length, step: state.step, status: state.status, missing };
      });
      t.equal(r.n, 1, 'one step listed');
      t.check(r.step !== null, 'getState names the step');
      t.equal(r.status, 'paused', 'gotoStep pauses there');
      t.equal(r.missing, 'not-found', 'an unknown step is not-found');
    },
  },
  {
    name: 'the panels show the picked key, the current row and the scene',
    async run(t) {
      await twoKeys(t);
      const o = await firstObject(t);
      await t.call(KEYS, 'keysActions', 'pickKeys', `o:${o.id}`, [1]);
      await t.probe('settle');
      t.check((await t.probe('panelText', 'animation')).includes('Key —'), 'the Key panel shows the key');
      await t.call(UI, 'animationUiActions', 'pick', { kind: 'none' });
      await t.call(UI, 'animationUiActions', 'setCurrent', '@camera');
      await t.probe('settle');
      t.check((await t.probe('panelText', 'animation')).includes('Camera'), 'then the Camera row');
      await t.call(UI, 'animationUiActions', 'setCurrent', null);
      await t.probe('settle');
      t.check((await t.probe('panelText', 'animation')).includes('Scene'), 'then the scene');
      const tl = await t.probe('panelText', 'animationTimeline');
      for (const row of ['Steps', 'Camera', 'Clipping', 'Colour rules', 'Overlays']) {
        t.check(tl.includes(row), `the Timeline has the ${row} row`);
      }
    },
  },
  {
    name: 'object items: the group minus the selection moves without it; adding it back drops the leave-out',
    async run(t) {
      await t.probe('select', [GROUP]);
      await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: true });
      await t.probe('settle', 500);
      const o = await firstObject(t);
      const all = await t.probe('itemCount', o.id);
      t.check(all > 7, 'the group holds its items');
      await t.probe('select', [SPK[0]]);
      await t.call(ITEMS, 'objectItemsActions', 'removeSelection', o.id);
      await t.probe('settle', 500);
      const less = await firstObject(t);
      t.equal([less.items, less.exclude], [[GROUP.toLowerCase()], [SPK[0].toLowerCase()]], 'the group minus the speaker');
      t.equal(await t.probe('itemCount', o.id), all - 7, 'its seven items are left out');
      const panel = await t.probe('panelText', 'animation');
      t.check(panel.includes(GROUP) && panel.includes(SPK[0]), 'the Items list spells them as the tree does');
      const [x0, x1] = [await t.probe('minX', SPK[0]), await t.probe('minX', SPK[1])];
      await t.probe('seek', 2);
      await t.call(POSING, 'posingActions', 'setPoseValues', { move: [2, 0, 0] }, o.id);
      await key(t);
      await t.probe('settle', 400);
      t.near(await t.probe('minX', SPK[1]), x1 + 2, 'the rest of the group moves', 0.01);
      t.near(await t.probe('minX', SPK[0]), x0, 'the left-out speaker stays', 0.01);
      await t.call(ITEMS, 'objectItemsActions', 'addSelection', o.id);
      await t.probe('settle', 500);
      t.equal((await firstObject(t)).exclude, [], 'adding it back drops the leave-out');
      t.equal(await t.probe('itemCount', o.id), all, 'all the items again');
      t.near(await t.probe('minX', SPK[0]), x0 + 2, 'and it moves with the group', 0.01);
      await t.probe('select', [GROUP]);
      await t.call(ITEMS, 'objectItemsActions', 'removeSelection', o.id);
      t.equal((await firstObject(t)).items, [GROUP.toLowerCase()], 'an object is never left empty');
    },
  },
  {
    name: 'closest group: nodes picked one by one become the group minus the rest',
    async run(t) {
      const kids = await t.probe('childrenOf', GROUP);
      t.check(kids.length > 4, 'the group has nodes');
      await t.probe('select', kids.slice(0, -2));
      await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: false });
      await t.probe('settle', 500);
      const o = await firstObject(t);
      const count = await t.probe('itemCount', o.id);
      t.equal(o.items.length, kids.length - 2, 'one entry per node');
      const g = await t.call(ITEMS, 'objectItemsActions', 'closestGroup', o.id);
      t.equal(g?.group, GROUP.toLowerCase(), 'the closest group');
      t.equal(g?.minus, kids.slice(-2).map((k) => k.toLowerCase()).sort(), 'minus the nodes not picked');
      t.check((await t.probe('panelText', 'animation')).includes('Closest group'), 'the Key panel suggests it');
      await t.call(ITEMS, 'objectItemsActions', 'applyClosestGroup', o.id);
      await t.probe('settle', 500);
      const after = await firstObject(t);
      t.equal([after.items, after.exclude.length], [[GROUP.toLowerCase()], 2], 'the group minus two');
      t.equal(await t.probe('itemCount', o.id), count, 'the same items');
      t.check(!(await t.probe('panelText', 'animation')).includes('Closest group'), 'nothing simpler to suggest now');
      await t.probe('select', [kids[0]]);
      await t.call(ITEMS, 'objectItemsActions', 'removeSelection', o.id);
      t.equal((await firstObject(t)).exclude.length, 3, 'removing a node inside the group leaves it out');
      await t.probe('select', [kids[kids.length - 1]]);
      await t.call(ITEMS, 'objectItemsActions', 'addSelection', o.id);
      t.equal((await firstObject(t)).exclude.length, 2, 'adding a left-out node drops its leave-out');
    },
  },
  {
    name: '+ Objects one per child: a group becomes its parts; Ctrl / Shift on the rows pose several at once',
    async run(t) {
      const kids = await t.probe('childrenOf', GROUP);
      await t.probe('select', [GROUP]);
      await t.probe('seek', 1);
      await t.call(OBJECTS, 'objectsActions', 'fromSelectionParts', 'children');
      await t.probe('settle', 500);
      const objects = await t.probe('objects');
      t.equal(objects.length, kids.length, 'one object per child');
      t.equal(
        objects.map((o) => o.items),
        kids.map((k) => [k.toLowerCase()]),
        'each holds its child, in tree order',
      );
      t.check(
        objects.every((o) => o.keys.length === 1 && o.keys[0].t === 1),
        'each keyed at the time slider',
      );
      t.check(
        (await t.probe('panelText', 'animationTimeline')).includes(`Objects (${kids.length})`),
        'under the Objects row',
      );
      await t.call(OBJECTS, 'objectsActions', 'fromSelectionParts', 'children');
      t.equal((await t.probe('objects')).length, kids.length, 'nodes that are objects already are skipped');
      const [a, b, c, d] = objects;
      await t.call(TIMELINE, 'timelineEditActions', 'pickRow', `o:${a.id}`);
      await t.probe('settle', 500);
      await t.call(TIMELINE, 'timelineEditActions', 'pickRow', `o:${c.id}`, { additive: true });
      await t.probe('settle', 500);
      t.equal((await t.probe('ui')).objectSelection, [a.id, c.id].sort(), 'Ctrl adds an object');
      await t.call(TIMELINE, 'timelineEditActions', 'pickRow', `o:${c.id}`, { additive: true });
      await t.probe('settle', 500);
      t.equal((await t.probe('ui')).objectSelection, [a.id], 'Ctrl again drops it');
      await t.call(TIMELINE, 'timelineEditActions', 'pickRow', `o:${c.id}`, { range: true });
      await t.probe('settle', 500);
      t.equal((await t.probe('ui')).objectSelection, [a.id, b.id, c.id].sort(), 'Shift picks the objects between');
      t.equal((await t.probe('ui')).current, `o:${a.id}`, 'the row clicked first stays current');
      await t.probe('seek', 2);
      await t.probe('drag', 1);
      await key(t);
      const after = await t.probe('objects');
      for (const o of [a, b, c]) {
        const k = after.find((x) => x.id === o.id)?.keys;
        t.near(k?.[1]?.move[0] ?? Number.NaN, 1, `${o.name} keyed at +1 m by one drag`);
      }
      t.equal(after.find((x) => x.id === d.id)?.keys.length, 1, 'an object not picked is left alone');
      await t.call(OBJECTS, 'objectsActions', 'selectObjects', after.map((o) => o.id));
      await t.probe('settle', 500);
      t.equal((await t.probe('ui')).objectSelection.length, kids.length, 'select all: every object');
    },
  },
  {
    name: 'quick colour rules: the selection coloured, hidden or alone, everything hidden, the model back',
    async run(t) {
      await t.probe('select', [SPK[1]]);
      await t.probe('seek', 1);
      await t.call(QUICK, 'quickRulesActions', 'fromSelection', 'hide');
      await t.probe('seek', 2);
      await t.call(QUICK, 'quickRulesActions', 'hideAll');
      await t.probe('seek', 3);
      await t.call(QUICK, 'quickRulesActions', 'showAll');
      await t.probe('select', [SPK[2]]);
      await t.probe('seek', 4);
      await t.call(QUICK, 'quickRulesActions', 'fromSelection', 'isolate');
      t.equal(
        (await t.probe('scene')).rules,
        [
          { t: 1, mode: 'append', rules: 1 },
          { t: 2, mode: 'hide', rules: 0 },
          { t: 3, mode: 'reset', rules: 0 },
          { t: 4, mode: 'hide', rules: 1 },
        ],
        'four colour-rules keys',
      );
      const rule = await t.eval(async () => {
        const { activeScene } = await import('/src/state/animation/docEdit.ts');
        return activeScene()?.colorRules[0].rules[0];
      });
      t.equal([rule?.filters[0].mode, rule?.filters[0].value, rule?.opacity], ['multi', SPK[1].toLowerCase(), 0], 'the selection, hidden');
      await t.probe('seek', 2.5);
      t.equal((await t.probe('frameInfo')).look, 'hide', 'everything hidden from 2');
      await t.probe('seek', 4.5);
      t.equal([(await t.probe('frameInfo')).look, (await t.probe('frameInfo')).rules], ['hide', 1], 'only the selection from 4');
      await t.call(QUICK, 'quickRulesActions', 'editInForce');
      await t.probe('settle');
      const sc = await t.eval(async () => {
        const { rulesEditorState } = await import('/src/state/animation/rulesEditor.state.ts');
        const s = rulesEditorState.get();
        return { mode: s.mode, value: s.rules[0]?.filters[0]?.value };
      });
      t.equal([(await t.probe('ui')).picked, (await t.probe('ui')).indices], ['keys', [3]], 'the rules in force are picked');
      t.equal(sc, { mode: 'hide', value: SPK[2].toLowerCase() }, 'and the Key panel edits them');
    },
  },
  {
    name: 'the toolbar: show / hide toggles, transparency from here, a viewpoint as a camera key',
    async run(t) {
      await twoKeys(t);
      const o = await firstObject(t);
      await t.probe('seek', 1);
      await t.call(KEYS, 'keysActions', 'toggleVisibleFromHere', o.id);
      await t.probe('seek', 1.5);
      await t.call(KEYS, 'keysActions', 'toggleVisibleFromHere', o.id);
      await t.probe('seek', 1.2);
      t.equal(await t.probe('visibleOf', SPK[0]), false, 'hidden from 1');
      await t.probe('seek', 1.8);
      t.equal(await t.probe('visibleOf', SPK[0]), true, 'shown again from 1.5');
      await t.eval(async () => {
        const { viewpointsState } = await import('/src/state/viewer/viewpoints.state.ts');
        const camera = { target: [1, 2, 3], azimuth: 1.25, elevation: 0.4, orbitDistance: 30, orthographic: false };
        viewpointsState.set({ list: [...viewpointsState.get().list, { id: 'vp-e2e', name: 'E2E', camera }] });
      });
      await t.probe('seek', 0.5);
      await t.call(KEYS, 'keysActions', 'keyViewpoint', 'vp-e2e');
      await t.probe('settle');
      t.equal((await t.probe('scene')).camera, [0.5], 'a camera key from the viewpoint');
      t.near((await t.probe('camera')).frame, 1.25, 'the frame looks through it', 0.001);
      await t.eval(async () => {
        const { viewpointsState } = await import('/src/state/viewer/viewpoints.state.ts');
        viewpointsState.set({ list: viewpointsState.get().list.filter((v) => v.id !== 'vp-e2e') });
      });
      const tl = await t.probe('panelText', 'animationTimeline');
      for (const label of ['Colour', 'Rules', 'Camera']) {
        t.check(tl.includes(label), `the toolbar has ${label}`);
      }
    },
  },
  {
    name: "the Key panel's rules: a picked key is edited in place; the next key previews on top, Key keys and picks it",
    async run(t) {
      await t.call(UI, 'animationUiActions', 'setCurrent', '@rules');
      await t.eval(async (rule) => {
        const { rulesEditorState } = await import('/src/state/animation/rulesEditor.state.ts');
        rulesEditorState.set({ mode: 'hide', rules: [rule] });
      }, KEEP_SX);
      await key(t);
      t.equal([(await t.probe('ui')).picked, (await t.probe('ui')).indices], ['keys', [0]], 'Key picks the new key');
      const edit = async (patch) =>
        t.eval(async (p) => {
          const { rulesEditorActions } = await import('/src/state/animation/rulesEditor.actions.ts');
          rulesEditorActions.updateRule(0, p);
        }, patch);
      await edit({ color: '#ff0000' });
      await edit({ color: '#00ff00' });
      await t.probe('settle');
      const rule0 = async () =>
        t.eval(async () => {
          const { activeScene } = await import('/src/state/animation/docEdit.ts');
          return activeScene()?.colorRules[0]?.rules[0]?.color;
        });
      t.equal(await rule0(), '#00ff00', 'the picked key changes in place');
      await t.call(DOC, 'animationDocActions', 'undo');
      await t.probe('settle');
      t.equal(await rule0(), null, 'a burst of edits is one undo step');
      const editor = async () =>
        t.eval(async () => {
          const { rulesEditorState } = await import('/src/state/animation/rulesEditor.state.ts');
          const r = rulesEditorState.get().rules[0];
          return r ? r.color : 'none';
        });
      t.equal(await editor(), null, 'the editor follows the undo');
      await t.call(UI, 'animationUiActions', 'pick', { kind: 'none' });
      await t.probe('seek', 2);
      await t.probe('settle');
      t.equal([(await t.probe('ui')).current, await editor()], ['@rules', 'none'], 'the next rules key starts empty');
      await t.eval(async () => {
        const { rulesEditorActions } = await import('/src/state/animation/rulesEditor.actions.ts');
        rulesEditorActions.addRule();
        rulesEditorActions.updateRule(0, { color: '#0000ff' });
        rulesEditorActions.updateFilter(0, 0, { value: 'sx-ha86-011a' });
      });
      await t.probe('settle');
      t.equal(await t.probe('previewLook'), { mode: 'hide', rules: 2 }, 'an Append draft previews on top of the rules in force');
      await key(t);
      t.equal((await t.probe('scene')).rules, [{ t: 0, mode: 'hide', rules: 1 }, { t: 2, mode: 'append', rules: 1 }], 'keyed');
      await t.call(UI, 'animationUiActions', 'pick', { kind: 'none' });
      await t.probe('seek', 3);
      await t.call('/src/state/animation/rulesEditor.actions.ts', 'rulesEditorActions', 'copyInForce');
      await t.probe('settle');
      const copied = await t.eval(async () => {
        const { rulesEditorState } = await import('/src/state/animation/rulesEditor.state.ts');
        const s = rulesEditorState.get();
        return [s.mode, s.rules.length];
      });
      t.equal(copied, ['hide', 2], 'Rules in force copies both keys’ rules');
      t.check((await t.probe('panelText', 'animation')).includes('Next rules key'), 'the Key panel shows the next rules key');
    },
  },
  {
    name: 'camera key: its position and target are shown and typed values move its view',
    async run(t) {
      await t.call(UI, 'animationUiActions', 'setCurrent', '@camera');
      await key(t);
      await t.call(KEYS, 'keysActions', 'pickKeys', '@camera', [0]);
      await t.probe('settle');
      t.check((await t.probe('panelText', 'animation')).includes('Position'), 'the Key panel shows the position');
      await t.call(KEYS, 'keysActions', 'setCameraPoints', 0, [10, 0, 0], [0, 0, 0]);
      const v = await t.eval(async () => {
        const { activeScene } = await import('/src/state/animation/docEdit.ts');
        const view = activeScene()?.camera[0]?.view;
        return view ? [view.target, Math.round(view.azimuth * 1000) / 1000, Math.round(view.elevation * 1000) / 1000, view.orbitDistance] : null;
      });
      t.equal(v, [[0, 0, 0], Math.round(Math.PI * 1000) / 1000, 0, 10], 'looking from +X at the origin');
      await t.call(KEYS, 'keysActions', 'setCameraPoints', 0, [1, 1, 1], [1, 1, 1]);
      t.equal((await t.eval(async () => (await import('/src/state/animation/docEdit.ts')).activeScene()?.camera[0]?.view.orbitDistance)), 10, 'one point twice is refused');
    },
  },
  {
    name: 'overlays: titles, captions and info cards from Overlay ▾ get lanes named by their design',
    async run(t) {
      await t.call(CALLOUTS, 'calloutsActions', 'addDesign', 'preset.titleCard');
      await t.probe('seek', 1);
      await t.call(CALLOUTS, 'calloutsActions', 'addDesign', 'preset.infoImage');
      await t.probe('settle');
      const tl = await t.probe('panelText', 'animationTimeline');
      t.check(tl.includes('Overlay ▾'), 'the toolbar has Overlay ▾');
      t.check(tl.includes('Title card'), 'a title card lane');
      t.check(tl.includes('Info card'), 'an info card lane');
      t.equal((await t.probe('scene')).callouts.length, 2, 'two overlays');
      const auto = await t.eval(async () => {
        const { settingsState } = await import('/src/components/panels/settings/settings.state.ts');
        const { findTheme } = await import('/src/state/animation/runtimeOverlay.ts');
        const { animationDocState } = await import('/src/state/animation/animationDoc.state.ts');
        const was = settingsState.get().theme;
        const doc = animationDocState.get().doc;
        settingsState.set({ theme: 'light' });
        const light = findTheme(doc, null)?.id;
        settingsState.set({ theme: 'dark' });
        const dark = findTheme(doc, null)?.id;
        const forced = findTheme(doc, 'theme.default')?.id;
        settingsState.set({ theme: was });
        return [light, dark, forced];
      });
      t.equal(auto, ['theme.light', 'theme.default', 'theme.default'], 'no theme = Auto follows the app; Dark forces dark');
    },
  },
  {
    name: "a key's pivot is the gizmo's: dragging it sets the offset, later keys keep it, sides are the object's own, the gizmo follows the slider",
    async run(t) {
      const TR = '/src/components/panels/ribbon-selection-transform/ribbonSelectionTransform.state.ts';
      const gizmoPivot = () =>
        t.eval(async (tr) => (await import(tr)).ribbonSelectionTransformState.get().pivot, TR);
      const setGizmoPivot = async (p) => {
        await t.eval(async (tr, q) => (await import(tr)).ribbonSelectionTransformState.set({ pivot: q }), TR, p);
        await t.probe('settle');
      };
      const nextPivot = () =>
        t.eval(async () => (await import('/src/state/animation/animationUi.state.ts')).animationUiState.get().nextPivot);
      const keyPivot = (i) =>
        t.eval(async (j) => (await import('/src/state/animation/docEdit.ts')).activeScene()?.objects[0]?.keys[j]?.pivot, i);
      await t.probe('select', [SPK[0]]);
      const box = await t.eval(async (name) => {
        const { db } = await import('/src/state/viewer/db.ts');
        const b = await db.boundsForNames([name]);
        return [...b.min, ...b.max];
      }, SPK[0]);
      const c = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
      const P = [box[3], box[1], c[2]];
      await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: true });
      await t.probe('settle');
      const o = await firstObject(t);
      t.near(await gizmoPivot(), c, 'the gizmo turns about the object pivot (its centre)', 0.01);
      await t.probe('seek', 2);
      await setGizmoPivot(P);
      t.near((await nextPivot())?.offset, [P[0] - c[0], P[1] - c[1], P[2] - c[2]], 'dragging the pivot sets the next key offset', 0.01);
      await t.eval(async (p) => {
        const { poseMatrix, qAxisAngle } = await import('/src/lib/animation/interp.ts');
        const { viewerActions } = await import('/src/state/viewer/viewer.actions.ts');
        await viewerActions.bakeSelectionTransform(poseMatrix({ move: [0, 0, 0], rotate: qAxisAngle([1, 0, 0], 90) }, p));
      }, P);
      await t.probe('settle');
      t.near(await gizmoPivot(), P, 'turning about it leaves the pivot where it is', 0.01);
      await key(t);
      t.equal((await keyPivot(1))?.at, 'center', 'the key keeps its side, with the offset');
      t.near(await t.call(KEYS, 'keysActions', 'keyPivotAt', o.id, 1), P, 'and turns about that point', 0.01);
      await t.probe('seek', 1);
      const hinge = await t.eval(async (id, p) => {
        const { currentFrame } = await import('/src/state/animation/runtime.ts');
        const { m4TransformPoint } = await import('/src/lib/animation/interp.ts');
        const m = currentFrame()?.poses.get(id);
        return m ? m4TransformPoint(m, p) : null;
      }, o.id, P);
      t.near(hinge, P, 'half way, it has turned about that point', 0.01);
      await t.probe('seek', 3);
      t.near(await gizmoPivot(), P, 'a later key carries the pivot on: the gizmo is still there', 0.01);
      await t.call(POSING, 'posingActions', 'setNextPivot', { at: 'bottom', offset: [0.1, 0, 0] });
      await t.call(POSING, 'posingActions', 'setNextPivot', { at: 'bottom', offset: [0, 0, 0] });
      await t.probe('settle');
      const ownBottom = await t.eval(async (b, p) => {
        const { m4TransformPoint, poseMatrix, qAxisAngle } = await import('/src/lib/animation/interp.ts');
        const bottom = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, b[2]];
        return m4TransformPoint(poseMatrix({ move: [0, 0, 0], rotate: qAxisAngle([1, 0, 0], 90) }, p), bottom);
      }, box, P);
      t.near(await gizmoPivot(), ownBottom, 'Bottom is the bottom of the object turned over, not of its box now', 0.01);
      const lifted = [ownBottom[0], ownBottom[1], ownBottom[2] + 0.2];
      await setGizmoPivot(lifted);
      const np = await nextPivot();
      t.equal(np?.at, 'bottom', 'dragged, the side stays');
      t.near(Math.hypot(...(np?.offset ?? [0, 0, 0])), 0.2, 'and the offset is how far it went', 0.005);
      t.near(await gizmoPivot(), lifted, 'the gizmo stays where it was dropped', 0.005);
      await key(t);
      t.equal((await keyPivot(2))?.at, 'bottom', 'keyed with its side and offset');
      await setGizmoPivot(null);
      t.near(await gizmoPivot(), lifted, 'a reset puts the gizmo back on the key pivot', 0.005);
      await t.call(KEYS, 'keysActions', 'pickKeys', `o:${o.id}`, [1]);
      await t.probe('settle');
      t.near(await gizmoPivot(), P, 'a picked key shows its own pivot', 0.01);
      await t.call(KEYS, 'keysActions', 'pickKeys', `o:${o.id}`, [2]);
      await t.probe('settle');
      t.near(await gizmoPivot(), lifted, 'another picked key, its pivot', 0.005);
      await t.probe('seek', 0);
      const atRest = await t.eval(async (p, w) => {
        const { m4InvertRigid, m4TransformPoint, poseMatrix, qAxisAngle } = await import('/src/lib/animation/interp.ts');
        return m4TransformPoint(m4InvertRigid(poseMatrix({ move: [0, 0, 0], rotate: qAxisAngle([1, 0, 0], 90) }, p)), w);
      }, P, lifted);
      t.near(await gizmoPivot(), atRest, 'the slider moved, the picked key still picked: the gizmo follows the object', 0.005);
      await t.call(KEYS, 'keysActions', 'setKeyPivot', o.id, 2, { at: [c[0], c[1], box[2]] });
      await t.call(KEYS, 'keysActions', 'pickKeys', `o:${o.id}`, [2]);
      await t.probe('settle');
      const shown = await t.probe('panelText', 'animation');
      t.check(shown.includes('Centre') && !shown.includes('Point'), 'a point pivot (an older key) reads as the Centre');
      await t.call(KEYS, 'keysActions', 'setKeyPivot', o.id, 1, null);
      t.equal((await keyPivot(1)) ?? null, null, 'Object pivot drops it');
    },
  },
  {
    name: 'the ribbon: New / Open / Save, Export and Panels sections; Camera keys switches between the camera keys and orbiting freely',
    async run(t) {
      const ribbon = await t.probe('panelText', 'ribbonAnimation');
      for (const label of ['New', 'Open', 'Save', 'Export', 'Video', 'Step stills', 'Brief for AI', 'Panels', 'Timeline', 'Overlay Preview', 'Camera keys']) {
        t.check(ribbon.includes(label), `the ribbon has ${label}`);
      }
      await t.call(PLAYER, 'playerActions', 'toggleCameraFollow');
      t.equal((await t.probe('camera')).follow, 'follow', 'no camera keys: nothing to switch');
      await t.call(UI, 'animationUiActions', 'setCurrent', '@camera');
      await key(t);
      await t.call(PLAYER, 'playerActions', 'toggleCameraFollow');
      t.equal((await t.probe('camera')).follow, 'free', 'off: orbit freely');
      await t.call(PLAYER, 'playerActions', 'stop');
      await t.call(PLAYER, 'playerActions', 'play');
      t.equal((await t.probe('camera')).follow, 'free', 'switched off, it stays off when playing again');
      await t.call(PLAYER, 'playerActions', 'pause');
      await t.call(PLAYER, 'playerActions', 'toggleCameraFollow');
      t.equal((await t.probe('camera')).follow, 'follow', 'on: the camera keys again');
    },
  },
  {
    name: 'host API: a Bookmark button in its own ribbon section sends the animation; present loads and plays it back',
    async run(t) {
      await twoKeys(t);
      const r = await t.eval(async () => {
        const { animationHandlers } = await import('/src/lib/messageApi/handlersAnimation.ts');
        await animationHandlers['animation.setBookmarkButton']({ p: { button: { label: 'Keep this' } } });
        let bad = '';
        try {
          await animationHandlers['animation.setBookmarkButton']({ p: { button: { label: ' ' } } });
        } catch (e) {
          bad = e.code ?? e.message;
        }
        return { bad };
      });
      await t.probe('settle');
      const ribbon = await t.probe('panelText', 'ribbonAnimation');
      t.check(ribbon.includes('Bookmark') && ribbon.includes('Keep this'), 'a Bookmark section with the button');
      t.equal(r.bad, 'bad-payload', 'an empty label is refused');
      const sent = await t.eval(async () => {
        const { hostBookmarkActions } = await import('/src/state/animation/hostBookmark.actions.ts');
        const p = hostBookmarkActions.payload();
        return p ? { label: p.label, objects: p.doc.scenes[0].objects.length, format: p.doc.format } : null;
      });
      t.equal(sent, { label: 'Keep this', objects: 1, format: 'tredespace.animation' }, 'a click sends the animation');
      const shown = await t.eval(async () => {
        const { animationHandlers } = await import('/src/lib/messageApi/handlersAnimation.ts');
        const { hostBookmarkActions } = await import('/src/state/animation/hostBookmark.actions.ts');
        const doc = hostBookmarkActions.payload()?.doc;
        await animationHandlers['animation.setBookmarkButton']({ p: { button: null } });
        await animationHandlers['animation.setMode']({ p: { mode: 'off' } });
        const res = await animationHandlers['animation.present']({ p: { doc, play: true } });
        await new Promise((r) => setTimeout(r, 600));
        const { playerState } = await import('/src/state/animation/player.state.ts');
        return {
          ok: res.ok && res.loaded?.ok,
          mode: playerState.get().mode,
          status: playerState.get().status,
          timeline: document.querySelector('.dock-panel[data-panel="animationTimeline"]') !== null,
          playBar: document.querySelector('[aria-label="Animation play bar"]') !== null,
        };
      });
      t.equal(shown, { ok: true, mode: 'playback', status: 'playing', timeline: false, playBar: true }, 'presenting: playing with the play bar');
      t.check(!(await t.probe('panelText', 'ribbonAnimation')).includes('Keep this'), 'the button is removed');
      const back = await t.eval(async () => {
        await (await import('/src/state/animation/present.actions.ts')).presentActions.close();
        await new Promise((r) => setTimeout(r, 600));
        const { playerState } = await import('/src/state/animation/player.state.ts');
        return {
          status: playerState.get().status,
          timeline: document.querySelector('.dock-panel[data-panel="animationTimeline"]') !== null,
        };
      });
      t.equal(back, { status: 'off', timeline: true }, 'Close: back to the panels and the mode (off) from before');
    },
  },
  {
    name: 'Present from authoring: the play bar toggles the camera keys; Close comes back to the panels and authoring',
    async run(t) {
      await t.call(UI, 'animationUiActions', 'setCurrent', '@camera');
      await key(t);
      await t.call('/src/state/animation/present.actions.ts', 'presentActions', 'enter');
      await t.probe('settle', 600);
      const bar = () => t.eval(() => document.querySelector('[aria-label="Animation play bar"]')?.textContent ?? '');
      t.check((await bar()).includes('Camera keys'), 'the play bar has the camera keys toggle');
      t.equal([(await t.probe('player')).mode, (await t.probe('panelText', 'animationTimeline')) === ''], ['playback', true], 'presenting: no Timeline');
      await t.eval(() => {
        const b = [...document.querySelectorAll('[aria-label="Animation play bar"] button')].find((x) => x.textContent?.includes('Camera keys'));
        b?.click();
      });
      t.equal((await t.probe('camera')).follow, 'free', 'the toggle frees the camera');
      await t.eval(() => {
        const b = [...document.querySelectorAll('[aria-label="Animation play bar"] button')].find((x) => x.textContent?.includes('Close'));
        b?.click();
      });
      await t.probe('settle', 800);
      t.equal((await t.probe('player')).mode, 'author', 'Close: authoring again');
      t.check((await t.probe('panelText', 'animationTimeline')).includes('Camera'), 'and the Timeline is back');
      t.check((await t.probe('panelText', 'animation')).length > 0, 'and the Key panel');
    },
  },
  {
    name: "a key's pivot under Rotate: a side keeps the pose; the next key's pivot is what typed Rotate turns about",
    async run(t) {
      await twoKeys(t);
      const o = await firstObject(t);
      const box = await t.eval(async (id) => {
        const { evalContext } = await import('/src/state/animation/runtime.ts');
        return Array.from(evalContext().boxes?.get(id) ?? []);
      }, o.id);
      const at = async (time, p) => {
        await t.probe('seek', time);
        return t.eval(async (id, x) => {
          const { currentFrame } = await import('/src/state/animation/runtime.ts');
          const { m4TransformPoint } = await import('/src/lib/animation/interp.ts');
          const m = currentFrame()?.poses.get(id);
          return m ? m4TransformPoint(m, x) : x;
        }, o.id, p);
      };
      const corner = [box[0], box[1], box[2]];
      const before = await at(2, corner);
      await t.call(KEYS, 'keysActions', 'setKeyPivotChoice', o.id, 1, { at: 'bottom', offset: [0, 0, 0.5] });
      const k1 = (await t.eval(async () => (await import('/src/state/animation/docEdit.ts')).activeScene()?.objects[0]?.keys[1])) ?? {};
      t.equal(k1.pivot, { at: 'bottom', offset: [0, 0, 0.5] }, 'the key takes the side and offset');
      t.near(await at(2, corner), before, 'and the object stays where it was', 0.001);
      t.check(t && Math.abs(k1.move[0] - 2) < 0.001, 'a pure move keeps its numbers');
      // the next key turns about the top of its box: typed Rotate turns about it
      await t.probe('seek', 3);
      await t.call(POSING, 'posingActions', 'setNextPivot', { at: 'top', offset: [0, 0, 0] });
      const top = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, box[5]];
      await t.call(POSING, 'posingActions', 'setPoseValues', { rotate: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }, o.id);
      await key(t);
      const k2 = (await t.eval(async () => (await import('/src/state/animation/docEdit.ts')).activeScene()?.objects[0]?.keys[2])) ?? {};
      t.equal(k2.pivot, { at: 'top' }, 'the next key keeps the chosen pivot');
      t.near(await at(3, top), [top[0] + 2, top[1], top[2]], 'turned about its top: the top stays where the move put it', 0.01);
      t.equal((await t.probe('ui')).current, `o:${o.id}`, 'still the object row');
    },
  },
  {
    name: 'Labels and Measurements rows: what is on screen keys from the time slider; on / off goes into the key',
    async run(t) {
      const live = () =>
        t.eval(async () => {
          const { labelsState } = await import('/src/state/viewer/labels.state.ts');
          const { measurementsState } = await import('/src/state/viewer/measurements.state.ts');
          return {
            labels: labelsState.get().items.map((l) => ({ text: l.text, muted: l.muted === true })),
            measurements: measurementsState.get().items.length,
          };
        });
      await t.probe('seek', 1);
      await t.call(UI, 'animationUiActions', 'setCurrent', '@labels');
      await t.eval(async () => {
        const { labelsActions } = await import('/src/state/viewer/labels.actions.ts');
        labelsActions.placeAt([0, 0, 0]);
      });
      await t.probe('settle');
      t.check((await t.probe('ui')).previewLabels, 'a new label waits for Key');
      await key(t);
      const keyed = await t.eval(async () => (await import('/src/state/animation/docEdit.ts')).activeScene()?.labels.map((k) => [k.t, k.labels.length]));
      t.equal(keyed, [[1, 1]], 'Key keyed the label at the time slider');
      t.equal([(await t.probe('ui')).picked, (await t.probe('ui')).previewLabels], ['keys', false], 'and picked the key');
      await t.probe('seek', 0.5);
      t.equal((await live()).labels.length, 0, 'no labels before the first key');
      await t.call(KEYS, 'keysActions', 'pickKeys', '@labels', [0]);
      await t.probe('settle');
      t.equal((await live()).labels.length, 1, 'the key shows its label');
      await t.eval(async () => {
        const { labelsState } = await import('/src/state/viewer/labels.state.ts');
        const { annotationsActions } = await import('/src/state/animation/annotations.actions.ts');
        annotationsActions.toggle('labels', labelsState.get().items[0].id);
      });
      const muted = await t.eval(async () => (await import('/src/state/animation/docEdit.ts')).activeScene()?.labels[0].labels[0].muted);
      t.equal(muted, true, 'switching it off goes into the picked key');
      // a measurement made at 2 s, keyed on the Measurements row
      await t.call(UI, 'animationUiActions', 'pick', { kind: 'none' });
      await t.probe('seek', 2);
      await t.call(UI, 'animationUiActions', 'setCurrent', '@measurements');
      await t.eval(async () => {
        const { measurementsState } = await import('/src/state/viewer/measurements.state.ts');
        const m = {
          id: 1, kind: 'line', points: [{ pos: [0, 0, 0] }, { pos: [1, 0, 0] }], label: 'Gap', visible: true, showLabel: true,
          showPerp: false, axisLegs: [false, false, false], axisLabels: [false, false, false], legsInLabel: false, slopeInLabel: false,
        };
        measurementsState.set({ items: [m] });
      });
      await key(t);
      t.equal((await t.eval(async () => (await import('/src/state/animation/docEdit.ts')).activeScene()?.measurements.map((k) => [k.t, k.measurements.length]))), [[2, 1]], 'the measurement is keyed');
      await t.probe('seek', 1.5);
      t.equal((await live()).measurements, 0, 'not before its key');
      t.check((await t.probe('panelText', 'animationTimeline')).includes('Measurements'), 'the Timeline has the rows');
    },
  },
  {
    name: "the scene's own labels are put aside while animating, come back exactly after, and From the scene brings them in",
    async run(t) {
      await t.call(UI, 'animationUiActions', 'exitMode');
      const own = await t.eval(async () => {
        const { labelsActions } = await import('/src/state/viewer/labels.actions.ts');
        const { labelsState } = await import('/src/state/viewer/labels.state.ts');
        labelsActions.placeAt([5, 5, 5]);
        const l = labelsState.get().items.at(-1);
        return { id: l.id, text: l.text, n: labelsState.get().items.length };
      });
      await t.call(UI, 'animationUiActions', 'enterAuthoring');
      await t.probe('settle', 500);
      const inMode = await t.eval(async () => {
        const { labelsState } = await import('/src/state/viewer/labels.state.ts');
        const { annotationsActions } = await import('/src/state/animation/annotations.actions.ts');
        return { shown: labelsState.get().items.length, inScene: annotationsActions.sceneCounts().labels };
      });
      t.equal(inMode, { shown: 0, inScene: own.n }, 'animating: none shown, the scene’s put aside');
      await t.call(UI, 'animationUiActions', 'setCurrent', '@labels');
      await t.call('/src/state/animation/annotations.actions.ts', 'annotationsActions', 'fromScene', 'labels');
      await key(t);
      t.equal((await t.eval(async () => (await import('/src/state/animation/docEdit.ts')).activeScene()?.labels[0]?.labels.length)), own.n, 'From the scene, then Key');
      await t.call(UI, 'animationUiActions', 'exitMode');
      const after = await t.eval(async () => {
        const { labelsState } = await import('/src/state/viewer/labels.state.ts');
        const l = labelsState.get().items.at(-1);
        return { id: l?.id, text: l?.text, n: labelsState.get().items.length };
      });
      t.equal(after, own, 'leaving gives the scene its own labels back, ids and all');
      await t.eval(async () => {
        const { labelsActions } = await import('/src/state/viewer/labels.actions.ts');
        labelsActions.replaceQuiet([]);
      });
    },
  },
  {
    name: 'scenes have names: New scene… and Rename ask for one; presenting, the play bar picks the scene',
    async run(t) {
      const sc = await t.eval(async () => {
        const { dialogs } = await import('/src/components/dialogs/dialogs.actions.ts');
        const answers = ['Assembly', 'Service'];
        const prompt = dialogs.prompt;
        dialogs.prompt = async () => answers.shift() ?? null;
        const { scenesActions } = await import('/src/state/animation/scenes.actions.ts');
        await scenesActions.renamePrompt();
        await scenesActions.newSceneNamed();
        dialogs.prompt = prompt;
        const { animationDocState } = await import('/src/state/animation/animationDoc.state.ts');
        const st = animationDocState.get();
        return { names: st.doc.scenes.map((x) => x.name), active: st.doc.scenes.find((x) => x.id === st.activeScene)?.name, first: st.doc.scenes[0].id };
      });
      t.equal([sc.names, sc.active], [['Assembly', 'Service'], 'Service'], 'renamed, and a new named scene made active');
      t.check((await t.probe('panelText', 'animationTimeline')).includes('Service'), 'the Timeline shows its name');
      await t.call(TIMELINE, 'timelineEditActions', 'select', { items: ['sc|'], points: [] }, false);
      await t.probe('settle');
      t.equal((await t.probe('ui')).current, '@scene', 'the Scene bar picks the Scene row');
      t.check((await t.probe('panelText', 'animation')).includes('Ping-pong'), 'and the Key panel shows the scene settings');
      await t.call('/src/state/animation/present.actions.ts', 'presentActions', 'enter');
      await t.probe('settle', 500);
      const bar = await t.eval(() => document.querySelector('[aria-label="Animation play bar"]')?.textContent ?? '');
      t.check(bar.includes('Service'), 'the play bar names the scene');
      await t.call(PLAYER, 'playerActions', 'switchScene', sc.first);
      await t.probe('settle', 500);
      const after = await t.eval(() => document.querySelector('[aria-label="Animation play bar"]')?.textContent ?? '');
      t.check(after.includes('Assembly'), 'and switches to another');
      await t.call('/src/state/animation/present.actions.ts', 'presentActions', 'close');
      await t.probe('settle', 500);
    },
  },
  {
    name: 'review: I keys and never inverts the selection; Ctrl+C on the Timeline copies keys, not the Set Color toggle',
    async run(t) {
      await t.probe('select', [SPK[0]]);
      await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: true });
      await t.probe('settle');
      const before = await t.probe('selectionCount');
      await t.probe('seek', 2);
      await t.probe('drag', 1);
      await t.eval(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      });
      await t.press('KeyI');
      await t.probe('settle', 600);
      t.equal((await firstObject(t)).keys.length, 2, 'I keyed the pose');
      t.equal(await t.probe('selectionCount'), before, 'the selection is not inverted');
      const o = await firstObject(t);
      await t.call(KEYS, 'keysActions', 'pickKeys', `o:${o.id}`, [1]);
      const setColor = () => t.eval(() => document.querySelector('.dock-panel[data-panel="multiColor"]') !== null);
      const open0 = await setColor();
      await t.eval(() =>
        document.querySelector('.dock-panel[data-panel="animationTimeline"] [tabindex="0"]')?.focus(),
      );
      await t.press('KeyC', ['Control']);
      await t.probe('settle');
      t.equal(await setColor(), open0, 'Ctrl+C on the Timeline leaves the Set Color panel alone');
      const copied = await t.eval(
        async () => (await import('/src/state/animation/keyClipboard.state.ts')).keyClipboardState.get().clip !== null,
      );
      t.check(copied, 'and copies the picked key');
    },
  },
  {
    name: "review: right-click on a row name keeps the time slider; a step is never added over the next one",
    async run(t) {
      await twoKeys(t);
      await t.probe('seek', 1.5);
      const name = (await firstObject(t)).name;
      await t.eval((n) => {
        const b = [...document.querySelectorAll('.dock-panel[data-panel="animationTimeline"] button')].find(
          (x) => x.textContent === n,
        );
        const r = b?.getBoundingClientRect();
        b?.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 4, clientY: r.y + 4 }),
        );
      }, name);
      await t.probe('settle');
      t.near(await t.probe('time'), 1.5, 'the time slider stays where it was', 0.001);
      await t.press('Escape');
      await t.probe('seek', 3);
      await t.call(STEPS, 'stepsActions', 'addAtSlider');
      await t.probe('seek', 2.95);
      t.equal(await t.call(STEPS, 'stepsActions', 'addAtSlider'), null, 'no room before the next step: refused');
      await t.probe('seek', 2.5);
      await t.call(STEPS, 'stepsActions', 'addAtSlider');
      const steps = (await t.probe('scene')).steps;
      t.equal(steps.map((x) => [x.start, x.end]), [[2.5, 3], [3, 8]], 'the new step ends where the next starts');
      const error = await t.eval(async () => {
        const { validateAnimationDoc } = await import('/src/lib/animation/io.ts');
        const { animationDocActions } = await import('/src/state/animation/animationDoc.actions.ts');
        return validateAnimationDoc(JSON.parse(JSON.stringify(animationDocActions.docForSave()))).error ?? null;
      });
      t.equal(error, null, 'the file still opens');
    },
  },
  {
    name: 'review: auto-key on items that are no object yet keys them where they were turned',
    async run(t) {
      await t.call(UI, 'animationUiActions', 'toggleAutoKey');
      await t.probe('select', [SPK[1]]);
      const c0 = await t.probe('center', SPK[1]);
      await t.probe('seek', 1);
      await t.eval(async (c) => {
        const { poseMatrix, qAxisAngle } = await import('/src/lib/animation/interp.ts');
        const { viewerActions } = await import('/src/state/viewer/viewer.actions.ts');
        await viewerActions.bakeSelectionTransform(poseMatrix({ move: [0, 0, 0], rotate: qAxisAngle([0, 0, 1], 90) }, c));
      }, c0);
      await t.probe('settle', 800);
      t.equal((await firstObject(t))?.keys.length, 1, 'an object with its key');
      t.near(await t.probe('center', SPK[1]), c0, 'turned about its centre, it stays there', 0.01);
      await t.call(UI, 'animationUiActions', 'toggleAutoKey');
    },
  },
  {
    name: 'review: typed values leave objects posed apart alone; Key on several objects is one undo step',
    async run(t) {
      for (const n of [SPK[0], SPK[1]]) {
        await t.probe('select', [n]);
        await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: true });
      }
      await t.probe('settle');
      const [a, b] = await t.probe('objects');
      await t.probe('seek', 2);
      await t.probe('select', [SPK[0]]);
      await t.probe('drag', 0, 0, 1);
      await t.probe('select', [SPK[1]]);
      await t.probe('drag', 2);
      await t.probe('settle');
      await t.call(POSING, 'posingActions', 'setPoseValues', { move: [2, 0, 0.5] }, b.id);
      await t.probe('settle');
      t.near(await t.probe('pose', SPK[0]), [0, 0, 1], 'A keeps its own pose');
      t.near(await t.probe('pose', SPK[1]), [2, 0, 0.5], 'B goes where it was typed');
      await key(t);
      const after = await t.probe('objects');
      t.near(after.find((x) => x.id === a.id)?.keys[1]?.move, [0, 0, 1], 'Key keys A as posed');
      t.near(after.find((x) => x.id === b.id)?.keys[1]?.move, [2, 0, 0.5], 'and B as typed');
      await t.call(DOC, 'animationDocActions', 'undo');
      t.equal((await t.probe('objects')).map((o) => o.keys.length), [1, 1], 'one Undo takes both keys back');
    },
  },
  {
    name: 'review: a colour-rules key keeps a pose; the next-key pivot stays with its object; a drag keeps the current row',
    async run(t) {
      for (const n of [SPK[0], SPK[1]]) {
        await t.probe('select', [n]);
        await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: true });
      }
      await t.probe('settle');
      const [a, b] = await t.probe('objects');
      await t.probe('seek', 2);
      await t.call(TIMELINE, 'timelineEditActions', 'pickRow', `o:${a.id}`);
      await t.probe('settle', 500);
      await t.probe('drag', 1);
      await t.eval(async () =>
        (await import('/src/state/animation/rulesEditor.state.ts')).rulesEditorState.set({ mode: 'reset', rules: [] }),
      );
      await t.call(KEYS, 'keysActions', 'keyRules');
      await t.probe('settle');
      t.equal((await t.probe('scene')).rules.length, 1, 'the rules are keyed');
      t.equal((await t.probe('ui')).posing, [a.id], 'and A is still posed');
      t.near(await t.probe('pose', SPK[0]), [1, 0, 0], 'where it was dragged');
      await t.call(POSING, 'posingActions', 'discardPose');
      await t.call(POSING, 'posingActions', 'setNextPivot', { at: 'bottom', offset: [0, 0.1, 0] });
      await t.call(TIMELINE, 'timelineEditActions', 'pickRow', `o:${b.id}`);
      await t.probe('settle', 500);
      const np = await t.eval(
        async () => (await import('/src/state/animation/animationUi.state.ts')).animationUiState.get().nextPivot,
      );
      t.equal(np, null, "A's next-key pivot does not follow to B");
      await t.call(TIMELINE, 'timelineEditActions', 'pickRow', `o:${a.id}`);
      await t.probe('settle', 500);
      await t.call(TIMELINE, 'timelineEditActions', 'pickRow', `o:${b.id}`, { range: true });
      await t.probe('settle', 500);
      await t.probe('drag', 0.5);
      t.equal((await t.probe('ui')).current, `o:${a.id}`, 'a drag on A and B keeps A current');
    },
  },
  {
    name: 'review: changing a pivot never moves the object; Point from the gizmo is a point of the object',
    async run(t) {
      await twoKeys(t);
      const o = await firstObject(t);
      const c2 = await t.probe('center', SPK[0]);
      await t.eval(async (c) => {
        const { poseMatrix, qAxisAngle } = await import('/src/lib/animation/interp.ts');
        const { viewerActions } = await import('/src/state/viewer/viewer.actions.ts');
        await viewerActions.bakeSelectionTransform(poseMatrix({ move: [0, 0, 0], rotate: qAxisAngle([1, 0, 0], 90) }, c));
      }, c2);
      await key(t);
      const turned = await t.probe('center', SPK[0]);
      await t.call(OBJECTS, 'objectsActions', 'setPivot', o.id, 'bottom');
      await t.probe('settle', 500);
      t.near(await t.probe('center', SPK[0]), turned, 'Object › Pivot Bottom: it stays put', 0.005);
      const rest = await t.eval(async (id) => {
        const { sessionRestBounds } = await import('/src/state/animation/runtime.ts');
        const b = sessionRestBounds(id);
        return b ? [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2] : null;
      }, o.id);
      await t.eval(async (p) => {
        const { ribbonSelectionTransformState } = await import(
          '/src/components/panels/ribbon-selection-transform/ribbonSelectionTransform.state.ts'
        );
        ribbonSelectionTransformState.set({ pivot: p, pivotSetting: false });
      }, turned);
      await t.call(OBJECTS, 'objectsActions', 'pivotFromGizmo', o.id);
      const pivot = await t.eval(
        async () => (await import('/src/state/animation/docEdit.ts')).activeScene()?.objects[0]?.pivot,
      );
      t.near(pivot, rest, 'the point under the gizmo, where the object stands in the model', 0.01);
      t.near(await t.probe('center', SPK[0]), turned, 'and it still stays put', 0.005);
    },
  },
  {
    name: 'review: Remove selection never leaves an object with nothing in it',
    async run(t) {
      const kids = await t.probe('childrenOf', GROUP);
      await t.probe('select', [GROUP]);
      await t.call(OBJECTS, 'objectsActions', 'fromSelection', { key: false });
      await t.probe('settle', 500);
      const o = await firstObject(t);
      await t.probe('select', kids);
      await t.call(ITEMS, 'objectItemsActions', 'removeSelection', o.id);
      await t.probe('settle');
      t.equal((await firstObject(t)).exclude, [], 'refused: the group keeps its items');
    },
  },
  {
    name: 'review: waiting at a step end keeps that step and its card; the unsaved-animation bar is offered',
    async run(t) {
      await t.eval(async () => {
        const { animationDocActions } = await import('/src/state/animation/animationDoc.actions.ts');
        const { mapActiveScene } = await import('/src/state/animation/docEdit.ts');
        const step = (id, start, end, pauseAtEnd) => ({ id, name: id.toUpperCase(), text: '', start, end, pauseAtEnd });
        animationDocActions.commit((d) =>
          mapActiveScene(d, (s) => ({ ...s, steps: [step('a', 0, 1, true), step('b', 1, 2, false)] })),
        );
      });
      await t.probe('seek', 0.5);
      await t.call(PLAYER, 'playerActions', 'play');
      await t.probe('settle', 1500);
      const p = await t.probe('player');
      t.equal([p.status, p.step], ['waiting', 'a'], 'it waits at the end of A, A still named');
      t.check((await t.probe('frameInfo')).overlays.includes('step:a'), "A's card is up while it waits");
      await t.call(PLAYER, 'playerActions', 'continue');
      await t.probe('settle', 400);
      t.equal((await t.probe('player')).step, 'b', 'Continue goes on to B');
      await t.call(PLAYER, 'playerActions', 'pause');
      await t.eval(async () =>
        (await import('/src/state/animation/animationDoc.state.ts')).animationDocState.set({ draftAvailable: true }),
      );
      await t.probe('settle');
      t.check(
        (await t.probe('panelText', 'animationTimeline')).includes('Recover the unsaved animation'),
        'the Timeline offers the unsaved animation',
      );
      await t.eval(async () =>
        (await import('/src/state/animation/animationDoc.state.ts')).animationDocState.set({ draftAvailable: false }),
      );
    },
  },
  {
    name: 'review: host presents over a presentation and setMode off brings the layout back; a bad doc changes nothing',
    async run(t) {
      await twoKeys(t);
      const r = await t.eval(async () => {
        const { animationHandlers } = await import('/src/lib/messageApi/handlersAnimation.ts');
        const { animationDocActions } = await import('/src/state/animation/animationDoc.actions.ts');
        const { animationUiState } = await import('/src/state/animation/animationUi.state.ts');
        const has = (id) => document.querySelector(`.dock-panel[data-panel="${id}"]`) !== null;
        let bad = '';
        try {
          await animationHandlers['animation.load']({ p: { doc: { format: 'tredespace.animation', version: 1 } } });
        } catch (e) {
          bad = e.code ?? e.message;
        }
        const afterBad = animationUiState.get().mode.kind;
        const doc = animationDocActions.docForSave();
        await animationHandlers['animation.present']({ p: { doc } });
        await new Promise((res) => setTimeout(res, 400));
        await animationHandlers['animation.present']({ p: { doc } });
        await new Promise((res) => setTimeout(res, 400));
        const presenting = !has('animationTimeline');
        await animationHandlers['animation.setMode']({ p: { mode: 'off' } });
        await new Promise((res) => setTimeout(res, 600));
        return { bad, afterBad, presenting, back: has('animationTimeline'), mode: animationUiState.get().mode.kind };
      });
      t.equal([r.bad, r.afterBad], ['bad-payload', 'author'], 'a bad doc is refused and authoring goes on');
      t.check(r.presenting, 'presenting twice: the 3D view alone');
      t.equal([r.back, r.mode], [true, 'off'], 'setMode off: the Timeline layout is back and the mode is off');
    },
  },
  {
    name: 'review: leaving while the mode is still starting really leaves',
    async run(t) {
      const r = await t.eval(async () => {
        const { animationUiActions } = await import('/src/state/animation/animationUi.actions.ts');
        const { animationUiState } = await import('/src/state/animation/animationUi.state.ts');
        const { playerState } = await import('/src/state/animation/player.state.ts');
        const { sessionActive } = await import('/src/state/animation/runtime.ts');
        await animationUiActions.exitMode();
        const entering = animationUiActions.enterAuthoring();
        await animationUiActions.exitMode();
        const ok = await entering;
        return { ok, mode: animationUiState.get().mode.kind, status: playerState.get().status, session: sessionActive() };
      });
      t.equal(r, { ok: false, mode: 'off', status: 'off', session: false }, 'the mode stays off');
      await t.call(UI, 'animationUiActions', 'enterAuthoring');
    },
  },
  {
    name: 'review: menu hotkeys open their menu; playing back only shows a read-only Timeline; K in the Timeline enters authoring',
    async run(t) {
      const opened = await t.eval(async () => {
        const { requestMenu } = await import('/src/components/panels/shared/menuRequests.ts');
        const ok = requestMenu('animation.menu.overlay');
        await new Promise((r) => setTimeout(r, 200));
        const menu = document.querySelector('[role="menu"]');
        const text = menu?.textContent ?? '';
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { ok, title: text.includes('Title card'), warning: text.includes('Warning banner') };
      });
      t.equal(opened, { ok: true, title: true, warning: true }, 'Overlay ▾ opens from its hotkey');
      await t.press('Escape');
      await t.call(UI, 'animationUiActions', 'exitMode');
      await t.call(UI, 'animationUiActions', 'enterPlayback');
      await t.probe('settle', 500);
      const tl = await t.probe('panelText', 'animationTimeline');
      t.check(tl.includes('Playing back only'), 'playing back only: the Timeline says so');
      const tools = await t.eval(
        () =>
          document.querySelector(
            '.dock-panel[data-panel="animationTimeline"] [data-tooltip^="The selection as an object"]',
          ) !== null,
      );
      t.equal(tools, false, 'and has no editing tools');
      t.equal((await t.probe('panelText', 'animation')).includes('Turn on Animate'), true, 'the Key panel waits for Animate');
      await t.call(UI, 'animationUiActions', 'exitMode');
      await t.eval(async () => {
        const { HOTKEYS } = await import('/src/hotkeys/bindings.ts');
        HOTKEYS.find((h) => h.id === 'animation.playPause')?.run();
        await new Promise((r) => setTimeout(r, 1500));
      });
      t.equal((await t.probe('player')).mode, 'author', 'K with the Timeline open enters authoring');
      await t.call(PLAYER, 'playerActions', 'pause');
    },
  },
  {
    name: 'host API: listScenes and setScene get and pick the active scene, with the mode on or off',
    async run(t) {
      await twoKeys(t);
      const r = await t.eval(async () => {
        const { animationHandlers } = await import('/src/lib/messageApi/handlersAnimation.ts');
        const { animationDocActions } = await import('/src/state/animation/animationDoc.actions.ts');
        const { emptyScene } = await import('/src/lib/animation/io.ts');
        const { playerState } = await import('/src/state/animation/player.state.ts');
        const { animationUiActions } = await import('/src/state/animation/animationUi.actions.ts');
        const second = { ...emptyScene('Maintenance'), id: 'sMaint' };
        animationDocActions.commit((d) => ({ ...d, scenes: [...d.scenes, second] }));
        const before = await animationHandlers['animation.listScenes']({ p: {} });
        const first = before.active;
        const set = await animationHandlers['animation.setScene']({ p: { id: 'sMaint' } });
        await new Promise((res) => setTimeout(res, 400));
        const on = { active: (await animationHandlers['animation.listScenes']({ p: {} })).active, status: playerState.get().status, time: playerState.get().time };
        let missing = '';
        try {
          await animationHandlers['animation.setScene']({ p: { id: 'nope' } });
        } catch (e) {
          missing = e.code ?? e.message;
        }
        await animationUiActions.exitMode();
        await animationHandlers['animation.setScene']({ p: { id: first } });
        const off = (await animationHandlers['animation.listScenes']({ p: {} })).active;
        const state = await animationHandlers['animation.getState']({ p: {} });
        return {
          names: before.scenes.map((s) => s.name),
          objects: before.scenes.map((s) => s.objects),
          set,
          on,
          missing,
          offIsFirst: off === first,
          stateScene: state.scene === first,
        };
      });
      t.equal(r.names.length, 2, 'two scenes listed');
      t.equal(r.objects, [1, 0], 'with their object counts');
      t.equal(r.set, { ok: true, scene: 'sMaint' }, 'setScene answers with the scene');
      t.equal([r.on.active, r.on.status, r.on.time], ['sMaint', 'stopped', 0], 'mode on: it is active, stopped at its start');
      t.equal(r.missing, 'not-found', 'an unknown id is not-found');
      t.check(r.offIsFirst && r.stateScene, 'mode off: setScene still picks it, and getState says so');
      await t.call(UI, 'animationUiActions', 'enterAuthoring');
    },
  },
  {
    name: 'export video: all scenes or one; one scene whole or a part from Start to End',
    async run(t) {
      await twoKeys(t);
      const r = await t.eval(async () => {
        const { animationDocActions } = await import('/src/state/animation/animationDoc.actions.ts');
        const { emptyScene } = await import('/src/lib/animation/io.ts');
        const { mapActiveScene } = await import('/src/state/animation/docEdit.ts');
        const { videoExportActions } = await import('/src/state/animation/videoExport.actions.ts');
        const { videoExportState } = await import('/src/state/animation/videoExport.state.ts');
        const { videoSegments } = await import('/src/lib/animation/videoFrames.ts');
        const { playerActions } = await import('/src/state/animation/player.actions.ts');
        const step = { id: 'st1', name: 'Lift', text: '', start: 0.5, end: 1.5, pauseAtEnd: true };
        animationDocActions.commit((d) => mapActiveScene(d, (sc) => ({ ...sc, steps: [step] })));
        const other = { ...emptyScene('Second'), id: 'sTwo', end: 3 };
        animationDocActions.commit((d) => ({ ...d, scenes: [...d.scenes, other] }));
        playerActions.seek(1);
        await new Promise((res) => setTimeout(res, 200));
        await videoExportActions.open();
        const plan = () => {
          const { settings, pick } = videoExportState.get();
          const doc = animationDocActions.docForSave();
          return videoSegments(doc.scenes, { ...settings, ...pick }, settings.holdS).map((x) => [x.scene, x.from, x.to]);
        };
        const text = () => document.querySelector('[role="dialog"]')?.textContent ?? '';
        videoExportActions.set({ scenes: 'one', span: 'part' });
        videoExportActions.partFromStep();
        await new Promise((res) => setTimeout(res, 200));
        const fromStep = { plan: plan(), fields: text().includes('Start') && text().includes('End') };
        videoExportActions.setPick({ scene: 'sTwo' });
        const otherScene = plan();
        videoExportActions.set({ scenes: 'all' });
        await new Promise((res) => setTimeout(res, 200));
        const all = { plan: plan(), length: text().includes('2 scenes') };
        videoExportActions.close();
        return { fromStep, otherScene, all };
      });
      t.equal(r.fromStep.plan.map((x) => [x[1], x[2]]), [[0.5, 1.5]], 'a part from the step at the time slider');
      t.check(r.fromStep.fields, 'Start and End are shown');
      t.equal(r.otherScene, [['sTwo', 0, 3]], 'another scene starts as all of it');
      t.equal(r.all.plan.length, 2, 'all scenes: both, one after another');
      t.check(r.all.length, 'the dialog says how long the video is');
    },
  },
  {
    name: 'the Timeline scrolls along: the time slider dragged past the edge pans the view and rides on the edge; ←/→ keep it in view',
    async run(t) {
      const STATE = '/src/state/animation/animationUi.state.ts';
      const view = () => t.eval(async (p) => (await import(p)).animationUiState.get().view, STATE);
      const PX_PER_S = 60;
      await t.call(UI, 'animationUiActions', 'set', { view: { pxPerSec: PX_PER_S, offset: 0 } });
      await t.probe('seek', 0);
      await t.probe('settle');
      const r = await t.eval(() => {
        const panel = '.dock-panel[data-panel="animationTimeline"]';
        const b = document.querySelector(`${panel} [aria-label="Time ruler"]`)?.getBoundingClientRect();
        return b ? { left: b.left, right: b.right, y: b.top + b.height / 2 } : null;
      });
      t.check(r !== null, 'the ruler is on screen');
      if (!r) {
        return;
      }
      const shown = (r.right - r.left) / PX_PER_S;
      // a real drag: press on the ruler, go 40 px past its right edge, hold
      await t.mouse.move(r.left + 40, r.y);
      await t.mouse.down();
      await t.mouse.move(r.right + 40, r.y, { steps: 6 });
      await new Promise((res) => setTimeout(res, 600));
      await t.mouse.up();
      const v = await view();
      const time = (await t.probe('player')).time;
      t.check(v.offset > 0.5, `held past the edge, the view panned (offset ${v.offset.toFixed(2)} s)`);
      t.check(time > shown, `the time slider rode along past the first screen (${time.toFixed(2)} s > ${shown.toFixed(2)} s)`);
      t.near(time, v.offset + shown, 'and it sits on the right edge', 0.05);
      // let go, the pan stops
      await new Promise((res) => setTimeout(res, 300));
      t.near((await view()).offset, v.offset, 'released: the view stays put', 1e-6);
      // ← / → walk the time slider; the view follows instead of losing it
      await t.call(UI, 'animationUiActions', 'set', { view: { pxPerSec: PX_PER_S, offset: 0 } });
      await t.probe('seek', shown - 0.5);
      await t.probe('settle');
      await t.eval(() =>
        document.querySelector('.dock-panel[data-panel="animationTimeline"] [aria-label="Timeline"]')?.focus(),
      );
      for (let i = 0; i < 2; i++) {
        await t.press('ArrowRight', ['Shift']);
      }
      const after = await view();
      const at = (await t.probe('player')).time;
      t.check(after.offset > 0, `→ past the edge panned the view (offset ${after.offset.toFixed(2)} s)`);
      t.check(at < after.offset + shown, 'the time slider is still in view');
      // keys: a plain drag moves one by the pointer's travel; held past the
      // edge, the view pans and the key rides along
      await t.call(UI, 'animationUiActions', 'set', { view: { pxPerSec: PX_PER_S, offset: 0 } });
      await t.probe('seek', 0);
      await twoKeys(t); // keys at 0 and 2
      const name = (await firstObject(t)).name;
      const keyAt = (time) =>
        t.eval((label) => {
          const panel = '.dock-panel[data-panel="animationTimeline"]';
          const el = [...document.querySelectorAll(`${panel} [aria-label]`)].find(
            (e) => e.getAttribute('aria-label') === label,
          );
          // the object's row may be below the lanes' fold
          el?.scrollIntoView({ block: 'center' });
          const b = el?.getBoundingClientRect();
          return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
        }, `${name} at ${time}`);
      const k2 = await keyAt('00:02.0');
      t.check(k2 !== null, 'the key at 2 s is on the Timeline');
      if (!k2) {
        return;
      }
      await t.mouse.move(k2.x, k2.y);
      await t.mouse.down();
      await t.mouse.move(k2.x + PX_PER_S, k2.y, { steps: 6 });
      await t.mouse.up();
      await t.probe('settle');
      t.near((await firstObject(t)).keys[1].t, 3, 'a plain key drag moves it by the pointer travel (60 px = 1 s)', 0.05);
      const k3 = await keyAt('00:03.0');
      const lanesRight = await t.eval(() => {
        const panel = '.dock-panel[data-panel="animationTimeline"]';
        const body = document.querySelector(`${panel} [aria-label="Timeline"] .overflow-y-auto`);
        return body ? body.getBoundingClientRect().left + body.clientWidth : 0;
      });
      t.check(k3 !== null && lanesRight > 0, 'the moved key and the lanes are found');
      if (!k3 || lanesRight === 0) {
        return;
      }
      await t.mouse.move(k3.x, k3.y);
      await t.mouse.down();
      await t.mouse.move(lanesRight + 40, k3.y, { steps: 6 });
      await new Promise((res) => setTimeout(res, 600));
      await t.mouse.up();
      await t.probe('settle');
      const keys = (await firstObject(t)).keys;
      t.check((await view()).offset > 0.5, 'a key held past the edge pans the view');
      t.check(keys[keys.length - 1].t > shown, `and the key rides along past the first screen (${keys[keys.length - 1].t} s)`);
    },
  },
  {
    name: 'the video file: frames stream into a file on disk — an MP4 with its index first (Fast Start) and every frame',
    async run(t) {
      const r = await t.probe('videoFile', 45, 30);
      t.check(!('error' in r), `the writer ran (${'error' in r ? r.error : r.codec})`);
      if ('error' in r) {
        return;
      }
      t.equal(r.packets, 45, 'every frame is in the file');
      t.near(r.duration, 1.5, 'it is 45 frames at 30 fps long', 0.05);
      const moov = r.boxes.indexOf('moov');
      t.check(moov >= 0 && moov < r.boxes.indexOf('mdat'), `the index comes before the frames (${r.boxes.join(' ')})`);
    },
  },
];
