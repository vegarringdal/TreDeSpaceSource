// Transform objects end-to-end scenarios (run by scripts/anim-e2e.mjs —
// npm run test:transform). Each starts with no objects and nothing moved
// (transformProbe.reset) and drives the app through the actions the ribbon,
// the panel and the gizmo call.

export const PROBE = '/tests/e2e/transformProbe.ts';
/** App layout F5 (Transform) — index 4. */
export const LAYOUT = 4;
export const PANELS = ['transformObjects'];

const SPK = ['/SX-HA86-011A', '/SX-HA86-012A', '/SX-HA86-013A'];
/** The speakers' group — it holds every SPK. */
const GROUP = '/HA-TELE-PA';
const ACTIONS = '/src/state/transform/transform.actions.ts';
const RIBBON = '/src/components/panels/ribbon-selection-transform/ribbonSelectionTransform.actions.ts';

const act = (t, method, ...args) => t.call(ACTIONS, 'transformActions', method, ...args);

/** Select `names` and make them an object; resolves its id (null: refused). */
async function newObject(t, names) {
  await t.probe('select', names);
  const id = await act(t, 'newFromSelection');
  await t.probe('sync');
  return id;
}

const plus = (p, d) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];

/** The pivot the Transform ribbon holds (null: none — the object's own). */
const ribbonPivot = (t) =>
  t.eval(async () => {
    const mod = await import('/src/components/panels/ribbon-selection-transform/ribbonSelectionTransform.state.ts');
    return mod.ribbonSelectionTransformState.get().pivot;
  });

export const SCENARIOS = [
  {
    name: 'a selection that is not an object does not move',
    async run(t) {
      const rest = await t.probe('center', SPK[0]);
      await t.probe('select', [SPK[0]]);
      await t.probe('drag', 2);
      await t.call(RIBBON, 'ribbonSelectionTransformActions', 'nudge', 'R');
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), rest, 'it stays where the model has it');
      t.equal((await t.probe('state')).objects.length, 0, 'no object was made');
    },
  },
  {
    name: 'New Object: the selection becomes the current object, named after its node',
    async run(t) {
      const id = await newObject(t, [SPK[0]]);
      const s = await t.probe('state');
      t.check(typeof id === 'string', 'an id comes back');
      t.equal(s.objects.length, 1, 'one object');
      t.equal(s.objects[0].name, 'SX-HA86-011A', 'named after the node');
      t.equal(s.current, 'SX-HA86-011A', 'it is the current object');
      t.equal(s.objects[0].summary, 'at rest', 'it has not moved');
      t.check(s.objects[0].items > 0, 'the worker counted its items');
      const working = await t.eval(async () => {
        const { dialogsState } = await import('/src/components/dialogs/dialogs.state.ts');
        return dialogsState.get().loading;
      });
      t.equal(working, null, 'no working dialog is left up');
    },
  },
  {
    name: 'the ribbon and the gizmo move the current object; the list says how far',
    async run(t) {
      const rest = await t.probe('center', SPK[0]);
      await newObject(t, [SPK[0]]);
      await t.call(RIBBON, 'ribbonSelectionTransformActions', 'nudge', 'R');
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), plus(rest, [1, 0, 0]), 'one step right');
      await t.probe('drag', 0, 0, 2);
      t.near(await t.probe('center', SPK[0]), plus(rest, [1, 0, 2]), 'then dragged up');
      const [o] = (await t.probe('state')).objects;
      t.near(o.move, [1, 0, 2], 'the object holds the whole move');
      t.equal(o.summary, '2.236 m', 'the row says the distance');
      t.near(await t.probe('gizmo'), plus(rest, [1, 0, 2]), 'the selection bounds follow');
    },
  },
  {
    name: 'undo and redo walk the object list',
    async run(t) {
      const rest = await t.probe('center', SPK[0]);
      await newObject(t, [SPK[0]]);
      await t.probe('drag', 3);
      t.equal((await t.probe('state')).undo, 2, 'two steps: the object, the move');
      await act(t, 'undo');
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), rest, 'the move is undone');
      await act(t, 'undo');
      await t.probe('sync');
      t.equal((await t.probe('state')).objects.length, 0, 'then the object');
      await act(t, 'redo');
      await act(t, 'redo');
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), plus(rest, [3, 0, 0]), 'redo brings both back');
    },
  },
  {
    name: 'a selection inside an object becomes its sub-object and rides on it',
    async run(t) {
      const rest0 = await t.probe('center', SPK[0]);
      const rest1 = await t.probe('center', SPK[1]);
      await newObject(t, [GROUP]);
      await newObject(t, [SPK[0]]);
      let s = await t.probe('state');
      t.equal(s.objects[1].parent, s.objects[0].name, 'the part rides on the group');
      t.equal(s.current, 'SX-HA86-011A', 'the part is current');
      await t.probe('drag', 0, 0, 1);
      t.near(await t.probe('center', SPK[0]), plus(rest0, [0, 0, 1]), 'the part moved');
      t.near(await t.probe('center', SPK[1]), rest1, 'the rest of the group did not');
      await act(t, 'select', s.objects[0].id);
      await t.probe('sync');
      s = await t.probe('state');
      t.equal(s.current, s.objects[0].name, 'picking the group row makes it current');
      await t.probe('drag', 5);
      t.near(await t.probe('center', SPK[1]), plus(rest1, [5, 0, 0]), 'the group moved');
      t.near(await t.probe('center', SPK[0]), plus(rest0, [5, 0, 1]), 'and carried the part');
      t.near((await t.probe('state')).objects[1].move, [0, 0, 1], 'the part keeps its own number');
    },
  },
  {
    name: 'an object made around a moved one adopts it without moving it',
    async run(t) {
      const rest0 = await t.probe('center', SPK[0]);
      await newObject(t, [SPK[0]]);
      await t.probe('drag', 0, 2);
      await newObject(t, [GROUP]);
      const s = await t.probe('state');
      t.equal(s.objects[0].parent, s.objects[1].name, 'the part now rides on the group');
      t.near(await t.probe('center', SPK[0]), plus(rest0, [0, 2, 0]), 'and stays where it was');
      await t.probe('drag', 1);
      t.near(await t.probe('center', SPK[0]), plus(rest0, [1, 2, 0]), 'the group carries it');
    },
  },
  {
    name: 'the same selection picks the object; a partly shared one is refused',
    async run(t) {
      const first = await newObject(t, [SPK[0], SPK[1]]);
      t.equal(await newObject(t, [SPK[0], SPK[1]]), first, 'the same items give the same object');
      t.equal(await newObject(t, [SPK[1], SPK[2]]), null, 'half inside, half outside is refused');
      t.equal((await t.probe('state')).objects.length, 1, 'still one object');
    },
  },
  {
    name: 'the current object follows the selection',
    async run(t) {
      await newObject(t, [SPK[0]]);
      await t.probe('select', [SPK[1]]);
      await t.probe('sync');
      t.equal((await t.probe('state')).current, null, 'another selection: no current object');
      await t.probe('select', [SPK[0]]);
      await t.probe('sync');
      t.equal((await t.probe('state')).current, 'SX-HA86-011A', 'its items selected again: current');
    },
  },
  {
    name: 'a quarter turn about the object’s own pivot leaves its move alone',
    async run(t) {
      const rest = await t.probe('center', SPK[0]);
      await newObject(t, [SPK[0]]);
      await t.call(RIBBON, 'ribbonSelectionTransformActions', 'rotate', 'frontToRight');
      await t.probe('sync');
      const [o] = (await t.probe('state')).objects;
      t.near(o.move, [0, 0, 0], 'no move');
      t.equal(o.summary, '90°', 'the row says the turn');
      t.near(await t.probe('center', SPK[0]), rest, 'the centre stays (the pivot is the centre)', 0.05);
    },
  },
  {
    name: 'typed numbers move the object; changing the pivot does not',
    async run(t) {
      const rest = await t.probe('center', SPK[0]);
      const id = await newObject(t, [SPK[0]]);
      await act(t, 'setPose', id, { move: [0, 0, 1.5], rotate: [0, 0, 0.7071068, 0.7071068] }, 'move');
      await t.probe('sync');
      const turned = await t.probe('center', SPK[0]);
      t.near(turned, plus(rest, [0, 0, 1.5]), 'typed move, turned about the centre', 0.05);
      await act(t, 'setPivot', id, { at: 'bottom', offset: [0.5, 0, 0] });
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), turned, 'a new pivot keeps it in place');
      t.check(
        JSON.stringify((await t.probe('state')).objects[0].move) !== JSON.stringify([0, 0, 1.5]),
        'the move is said about the new pivot',
      );
    },
  },
  {
    name: 'Set Pivot on the ribbon writes the object’s pivot; Reset drops it',
    async run(t) {
      const ribbon = (method, ...args) => t.call(RIBBON, 'ribbonSelectionTransformActions', method, ...args);
      const rest = await t.probe('center', SPK[0]);
      await newObject(t, [SPK[0]]);
      await t.probe('drag', 2);
      const at = plus(rest, [2, 0, 0]);
      await ribbon('startSetPivot');
      t.near(await ribbonPivot(t), at, 'placement starts on the object’s pivot');
      await ribbon('movePivot', plus(at, [0.5, 0, -0.25]));
      await ribbon('lockPivot');
      await t.probe('sync');
      let [o] = (await t.probe('state')).objects;
      t.equal(o.pivot.at, 'center', 'the side is kept');
      t.near(o.pivot.offset, [0.5, 0, -0.25], 'the list shows the offset');
      t.equal(await ribbonPivot(t), null, 'the ribbon holds no pivot of its own');
      t.near(await t.probe('center', SPK[0]), at, 'the object did not move');
      await ribbon('rotate', 'frontToRight');
      await t.probe('sync');
      // a quarter turn about a pivot 0.5 m to the right: the centre swings round it
      t.near(await t.probe('center', SPK[0]), plus(at, [0.5, -0.5, 0]), 'it turns about the placed pivot', 0.05);
      const turned = await t.probe('center', SPK[0]);
      await ribbon('resetPivot');
      await t.probe('sync');
      [o] = (await t.probe('state')).objects;
      t.near(o.pivot.offset, [0, 0, 0], 'Reset drops the offset');
      t.near(await t.probe('center', SPK[0]), turned, 'and does not move the object');
      await ribbon('startSetPivot');
      await ribbon('movePivot', [0, 0, 0]);
      await ribbon('cancelPivot');
      await t.probe('sync');
      t.near((await t.probe('state')).objects[0].pivot.offset, [0, 0, 0], 'Cancel writes nothing');
    },
  },
  {
    name: 'a group with a few parts deselected becomes the group minus those parts',
    async run(t) {
      const rest0 = await t.probe('center', SPK[0]);
      const rest1 = await t.probe('center', SPK[1]);
      const parts = await t.probe('childrenOf', GROUP);
      await newObject(
        t,
        parts.filter((p) => p !== SPK[0]),
      );
      const [o] = (await t.probe('state')).objects;
      t.equal(o.nodes, [GROUP.toLowerCase()], 'one node: the group');
      t.equal(o.leftOut, [SPK[0].toLowerCase()], 'the deselected part is left out');
      t.equal(o.name, 'HA-TELE-PA', 'named after the group');
      await t.probe('drag', 2);
      t.near(await t.probe('center', SPK[1]), plus(rest1, [2, 0, 0]), 'the group moves');
      t.near(await t.probe('center', SPK[0]), rest0, 'the left-out part stays');
      // two nodes of many: listing them is shorter than the group minus the rest
      await newObject(t, [SPK[1], SPK[2]]);
      t.equal((await t.probe('state')).objects[1].nodes.length, 2, 'a small pick stays a list of its nodes');
    },
  },
  {
    name: 'Add / Remove selection fix an object’s items',
    async run(t) {
      const rest1 = await t.probe('center', SPK[1]);
      const id = await newObject(t, [SPK[0]]);
      const before = (await t.probe('state')).objects[0].items;
      await t.probe('drag', 2);
      await t.probe('select', [SPK[1]]);
      await t.probe('sync');
      t.equal(await act(t, 'editItems', id, 'add'), true, 'the selection is added');
      await t.probe('sync');
      let s = await t.probe('state');
      t.check(s.objects[0].items > before, 'the object holds more items');
      t.equal(s.current, 'SX-HA86-011A', 'its items are selected: it is current again');
      t.near(await t.probe('center', SPK[1]), plus(rest1, [2, 0, 0]), 'the added items take the object’s pose');
      await t.probe('select', [SPK[1]]);
      await t.probe('sync');
      // the hotkey acts on the object that was current last
      await act(t, 'editLastItems', 'remove');
      await t.probe('sync');
      s = await t.probe('state');
      t.equal(s.objects[0].items, before, 'back to the first items');
      t.near(await t.probe('center', SPK[1]), rest1, 'what was taken out stands at rest');
      await act(t, 'undo');
      await t.probe('sync');
      t.near(await t.probe('center', SPK[1]), plus(rest1, [2, 0, 0]), 'undo puts it back in the object');
    },
  },
  {
    name: 'an item edit that would half-share another object is refused',
    async run(t) {
      const a = await newObject(t, [SPK[0]]);
      await newObject(t, [SPK[1], SPK[2]]);
      await t.probe('select', [SPK[1]]);
      await t.probe('sync');
      t.equal(await act(t, 'editItems', a, 'add'), false, 'adding half of another object is refused');
      await t.probe('select', [SPK[0]]);
      await t.probe('sync');
      t.equal(await act(t, 'editItems', a, 'remove'), false, 'emptying an object is refused');
      t.equal((await t.probe('state')).objects.length, 2, 'nothing changed');
    },
  },
  {
    name: 'the list scrolls under a fixed top section; collapse / expand all and per container',
    async run(t) {
      const ui = (method, ...args) =>
        t.call('/src/components/panels/transform-objects/transformObjectsUi.actions.ts', 'transformObjectsUiActions', method, ...args);
      const group = await newObject(t, [GROUP]);
      await newObject(t, [SPK[0]]);
      await newObject(t, [SPK[1]]);
      await newObject(t, [SPK[2]]);
      const panel = () =>
        t.eval(() => {
          const root = document.querySelector('.dock-panel[data-panel="transformObjects"]');
          const scroller = root.querySelector('.overflow-y-auto .overflow-y-auto');
          // one header per row (Selects carry aria-expanded too)
          const rows = [...scroller.querySelectorAll('.bg-slate-800 > button[aria-expanded]')];
          const body = root.querySelector('.panel-body');
          const top = root.querySelector('button[aria-expanded]').getBoundingClientRect();
          const box = root.getBoundingClientRect();
          return {
            open: rows.map((b) => b.getAttribute('aria-expanded') === 'true'),
            listScrolls: scroller.scrollHeight > scroller.clientHeight + 1,
            panelScrolls: body.scrollHeight > body.clientHeight + 1,
            topVisible: top.top >= box.top && top.bottom <= box.bottom,
          };
        });
      await ui('setAllOpen', true);
      await t.probe('settle');
      let p = await panel();
      t.equal(p.open, [true, true, true, true], 'Expand all opens every row');
      t.check(p.listScrolls, 'the list scrolls on its own');
      t.check(!p.panelScrolls && p.topVisible, 'the top section stays in view');
      await ui('toggleSubObjects', group);
      await t.probe('settle');
      t.equal((await panel()).open, [true, false, false, false], 'a container collapses its sub-objects');
      await ui('toggleSubObjects', group);
      await t.probe('settle');
      t.equal((await panel()).open, [true, true, true, true], 'and expands them again');
      await ui('setSubObjectsOpen', group, false);
      await t.probe('settle');
      t.equal((await panel()).open, [true, false, false, false], 'the container’s own Collapse all');
      await ui('setSubObjectsOpen', group, true);
      await t.probe('settle');
      t.equal((await panel()).open, [true, true, true, true], 'and its Expand all');
      await ui('setAllOpen', false);
      await t.probe('settle');
      p = await panel();
      t.equal(p.open, [false, false, false, false], 'Collapse all closes every row');
    },
  },
  {
    name: 'detaching keeps the part in place and stops it riding',
    async run(t) {
      const rest0 = await t.probe('center', SPK[0]);
      const group = await newObject(t, [GROUP]);
      const part = await newObject(t, [SPK[0]]);
      await act(t, 'select', group);
      await t.probe('sync');
      await t.probe('drag', 4);
      await act(t, 'setParent', part, null);
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), plus(rest0, [4, 0, 0]), 'detached where it was drawn');
      t.near((await t.probe('state')).objects[1].move, [4, 0, 0], 'its own move now holds the 4 m');
      await t.probe('drag', 1);
      t.near(await t.probe('center', SPK[0]), plus(rest0, [4, 0, 0]), 'the group no longer carries it');
      await act(t, 'setParent', part, group);
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), plus(rest0, [4, 0, 0]), 'riding again, still in place');
      t.near((await t.probe('state')).objects[1].move, [-1, 0, 0], 'said from the group again');
    },
  },
  {
    name: 'deleting a container puts its items back and keeps its sub-objects in place',
    async run(t) {
      const rest0 = await t.probe('center', SPK[0]);
      const rest1 = await t.probe('center', SPK[1]);
      const group = await newObject(t, [GROUP]);
      await t.probe('drag', 3);
      await newObject(t, [SPK[0]]);
      await act(t, 'remove', group);
      await t.probe('sync');
      const s = await t.probe('state');
      t.equal(s.objects.length, 1, 'the part is left');
      t.equal(s.objects[0].parent, null, 'standing on its own');
      t.near(await t.probe('center', SPK[0]), plus(rest0, [3, 0, 0]), 'where it was drawn');
      t.near(await t.probe('center', SPK[1]), rest1, 'the group’s own items went back');
    },
  },
  {
    name: 'mute shows an object at rest and keeps its numbers',
    async run(t) {
      const rest = await t.probe('center', SPK[0]);
      const id = await newObject(t, [SPK[0]]);
      await t.probe('drag', 2);
      await act(t, 'toggleMuted', id);
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), rest, 'muted: at rest');
      t.near((await t.probe('state')).objects[0].move, [2, 0, 0], 'the move is kept');
      await act(t, 'toggleMuted', id);
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), plus(rest, [2, 0, 0]), 'unmuted: moved again');
    },
  },
  {
    name: 'Bigger grows the object evenly',
    async run(t) {
      await newObject(t, [SPK[0]]);
      await t.call(RIBBON, 'ribbonSelectionTransformActions', 'scale', 1);
      await t.probe('sync');
      const [sx, sy, sz] = (await t.probe('state')).objects[0].scale;
      t.check(sx > 1 && Math.abs(sx - sy) < 1e-3 && Math.abs(sy - sz) < 1e-3, `an even scale above 1 (${sx})`);
    },
  },
  {
    name: 'Reset Object and Reset All put objects back and keep them in the list',
    async run(t) {
      const rest0 = await t.probe('center', SPK[0]);
      const rest1 = await t.probe('center', SPK[1]);
      await newObject(t, [SPK[0]]);
      await t.probe('drag', 2);
      await newObject(t, [SPK[1]]);
      await t.probe('drag', 0, 3);
      await act(t, 'resetCurrent');
      await t.probe('sync');
      t.near(await t.probe('center', SPK[1]), rest1, 'the current object is back');
      t.near(await t.probe('center', SPK[0]), plus(rest0, [2, 0, 0]), 'the other is not');
      await act(t, 'resetAll');
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), rest0, 'Reset All: everything back');
      t.equal((await t.probe('state')).objects.length, 2, 'both objects stay in the list');
    },
  },
  {
    name: 'save and load bring the objects back, sub-objects and all',
    async run(t) {
      const rest0 = await t.probe('center', SPK[0]);
      await newObject(t, [GROUP]);
      await t.probe('drag', 2);
      await newObject(t, [SPK[0]]);
      await t.probe('drag', 0, 0, 1);
      const json = await t.eval(async () => {
        const { serializeTransformDoc } = await import('/src/lib/transform/io.ts');
        const { transformState } = await import('/src/state/transform/transform.state.ts');
        return serializeTransformDoc(transformState.get().objects);
      });
      await act(t, 'clear');
      await t.probe('sync');
      t.near(await t.probe('center', SPK[0]), rest0, 'cleared: at rest');
      const loaded = await act(t, 'importJson', json);
      await t.probe('sync');
      t.equal(loaded.data, 2, 'two objects loaded');
      t.near(await t.probe('center', SPK[0]), plus(rest0, [2, 0, 1]), 'both poses are back');
      t.equal((await t.probe('state')).objects[1].parent, 'HA-TELE-PA', 'and what rides on what');
      const bad = await act(t, 'importJson', '{"format":"other"}');
      t.check(typeof bad.error?.msg === 'string', 'a wrong file is refused with a message');
    },
  },
  {
    name: 'To animation: a container and its sub-object become animation objects keyed at 0 s',
    async run(t) {
      const ui = (method, ...args) =>
        t.call('/src/components/panels/transform-objects/transformObjectsUi.actions.ts', 'transformObjectsUiActions', method, ...args);
      const rest0 = await t.probe('center', SPK[0]);
      const rest1 = await t.probe('center', SPK[1]);
      const group = await newObject(t, [GROUP]);
      await t.probe('drag', 2);
      const part = await newObject(t, [SPK[0]]);
      await t.probe('drag', 0, 0, 1);
      await act(t, 'setPivot', part, { at: 'bottom' });
      await t.probe('sync');
      await ui('setWithSubObjects', true);
      await ui('toAnimation', group);
      await t.probe('settle', 500);
      const made = await t.probe('animObjects');
      t.equal(made.map((o) => [o.name, o.parent]), [['HA-TELE-PA', null], ['SX-HA86-011A', 'HA-TELE-PA']], 'both, as a tree');
      t.equal(made.map((o) => o.keys.map((k) => k.t)), [[0], [0]], 'each keyed at the first frame');
      t.near(made[0].keys[0].move, [2, 0, 0], 'the container’s move');
      t.equal(made[1].pivot, 'bottom', 'the part keeps its pivot');
      await t.probe('animate', true);
      t.near(await t.probe('center', SPK[0]), plus(rest0, [2, 0, 1]), 'the animation starts where it was set up');
      t.near(await t.probe('center', SPK[1]), plus(rest1, [2, 0, 0]), 'the container too');
      await t.probe('animate', false);
      await ui('toAnimation', group);
      await t.probe('settle', 500);
      t.equal((await t.probe('animObjects')).length, 2, 'adding it again makes no copies');
    },
  },
  {
    name: 'To animation without sub-objects sends the container alone, the part left out',
    async run(t) {
      const ui = (method, ...args) =>
        t.call('/src/components/panels/transform-objects/transformObjectsUi.actions.ts', 'transformObjectsUiActions', method, ...args);
      const rest0 = await t.probe('center', SPK[0]);
      const rest1 = await t.probe('center', SPK[1]);
      const group = await newObject(t, [GROUP]);
      await t.probe('drag', 2);
      await newObject(t, [SPK[0]]);
      await ui('setWithSubObjects', false);
      await ui('toAnimation', group);
      await t.probe('settle', 500);
      await ui('setWithSubObjects', true);
      const made = await t.probe('animObjects');
      t.equal(made.length, 1, 'one object');
      t.equal(made[0].exclude, [SPK[0].toLowerCase()], 'the sub-object’s items are left out');
      await t.probe('animate', true);
      t.near(await t.probe('center', SPK[1]), plus(rest1, [2, 0, 0]), 'the container plays its move');
      t.near(await t.probe('center', SPK[0]), rest0, 'the left-out part stands at rest');
      await t.probe('animate', false);
    },
  },
  {
    name: 'animation starts clean and gives the objects back; edits rest meanwhile',
    async run(t) {
      const rest = await t.probe('center', SPK[0]);
      const id = await newObject(t, [SPK[0]]);
      await t.probe('drag', 2);
      await t.probe('animate', true);
      t.near(await t.probe('center', SPK[0]), rest, 'animating: where the model has it');
      const resting = () =>
        t.eval(() => {
          const root = document.querySelector('.dock-panel[data-panel="transformObjects"]');
          return {
            says: root.textContent.includes('Animation is active'),
            fieldsOff: [...root.querySelectorAll('fieldset')].every((f) => f.disabled),
          };
        });
      t.equal(await resting(), { says: true, fieldsOff: true }, 'the panel says so and its fields are off');
      await t.probe('select', [SPK[1]]);
      await act(t, 'select', id);
      await t.probe('sync');
      t.equal((await t.probe('state')).current, 'SX-HA86-011A', 'a row can still be selected while animating');
      await act(t, 'setPose', id, { move: [9, 0, 0] }, 'move');
      t.near((await t.probe('state')).objects[0].move, [2, 0, 0], 'the edit is refused');
      await t.probe('animate', false);
      await t.probe('sync');
      t.equal(await resting(), { says: false, fieldsOff: false }, 'back out: the notice is gone, the fields are on');
      t.near(await t.probe('center', SPK[0]), plus(rest, [2, 0, 0]), 'back out: moved again');
    },
  },
];
