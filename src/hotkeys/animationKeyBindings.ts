// Key panel and Timeline shortcuts (DESIGN.md › Animation › Authoring):
// instant keys, Slide in, the gizmo, steps, the picked key's fields, camera /
// section / colour-rules key options and callouts. Kept commands keep their
// ALT 9xx / 13xx / 14xx codes; the new ones are ALT 1507-1548 — never
// renumber.

import type { HotkeyDef } from '@treDeSpaceUI/hotkeys';
import { toast } from '@treDeSpaceUI/widgets';
import { openAnimationPanel } from '../components/panels/animation/animationPanels';
import { SLIDE_DIRECTIONS } from '../lib/animation/keyRows';
import { PIVOT_ANCHORS } from '../lib/animation/pivots';
import type { Interp, ObjectKey } from '../lib/animation/types';
import {
  PRESET_CAPTION,
  PRESET_INFO_IMAGE,
  PRESET_STEP_CARD,
  PRESET_TITLE,
  PRESET_WARNING,
} from '../lib/overlay/overlayPresets';
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN } from '../lib/overlay/overlayStyle';
import { animationDocState } from '../state/animation/animationDoc.state';
import { animationUiActions } from '../state/animation/animationUi.actions';
import { animationUiState } from '../state/animation/animationUi.state';
import { calloutsActions } from '../state/animation/callouts.actions';
import { activeScene } from '../state/animation/docEdit';
import { keysActions } from '../state/animation/keys.actions';
import { objectsActions } from '../state/animation/objects.actions';
import { overlayEditorActions } from '../state/animation/overlayEditor.actions';
import { playerActions } from '../state/animation/player.actions';
import { posingActions } from '../state/animation/posing.actions';
import { isSetRow, type KeyRow, rowObject } from '../state/animation/rows';
import { rulesEditorActions } from '../state/animation/rulesEditor.actions';
import { runtimeRenderer } from '../state/animation/runtime';
import { flyCameraTo } from '../state/animation/runtimeCamera';
import { scenesActions } from '../state/animation/scenes.actions';
import { stepsActions } from '../state/animation/steps.actions';

// -----------------------------------------------------------------------------
// constants + guards
// -----------------------------------------------------------------------------

const CATEGORY = 'Animation';
const authoring = () => animationUiActions.isAuthoring();
const SPIN_STEP = 45;
const OPACITY_STEP = 0.05;
const SCALE_STEP = 0.1;
const DISTANCE_STEP = 0.1;
const DURATION_STEP = 0.25;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

const round = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, min: number, max: number) => round(Math.min(max, Math.max(min, v)));

/** The current object row's id (a toast when there is none). */
function currentObject(): string | null {
  const id = rowObject(animationUiState.get().current);
  if (!id) {
    toast.info('Pick an object row in the Timeline first.');
  }
  return id;
}

/** The picked object key. */
function pickedObjectKey(): { object: string; index: number; key: ObjectKey } | null {
  const p = animationUiState.get().picked;
  const object = p.kind === 'keys' ? rowObject(p.row) : null;
  const index = p.kind === 'keys' ? p.indices[0] : undefined;
  const key = object && index !== undefined ? keysActions.object(object)?.keys[index] : undefined;
  return object && index !== undefined && key ? { object, index, key } : null;
}

/** The picked keys of a row kind. */
function pickedKeys(match: (row: KeyRow) => boolean): { row: KeyRow; indices: number[] } | null {
  const p = animationUiState.get().picked;
  return p.kind === 'keys' && match(p.row) ? { row: p.row, indices: p.indices } : null;
}

/** The picked callout's overlay instance id. */
function pickedInstance(): string | null {
  const p = animationUiState.get().picked;
  return p.kind === 'callout' ? (activeScene()?.callouts.find((c) => c.id === p.id)?.instance ?? null) : null;
}

function pickedStepId(): string | null {
  const p = animationUiState.get().picked;
  return p.kind === 'step' ? p.id : (stepsActions.atSlider()?.id ?? null);
}

function patchKey(patch: (k: ObjectKey) => Partial<ObjectKey> | null, coalesce: string): void {
  const k = pickedObjectKey();
  const next = k ? patch(k.key) : null;
  if (k && next) {
    keysActions.updateObjectKey(k.object, k.index, next, `${coalesce}:${k.object}:${k.index}`);
  }
}

function setInterp(interp: Interp): void {
  const keys = pickedKeys((r) => !isSetRow(r));
  if (keys) {
    keysActions.setInterp(keys.row, keys.indices, interp);
  } else {
    posingActions.setNextInterp(interp);
  }
}

function bumpInstance(field: 'scale' | 'textScale', dir: -1 | 1): void {
  const id = pickedInstance();
  const inst = id ? animationDocState.get().doc.overlayInstances.find((i) => i.id === id) : undefined;
  if (!inst) {
    return;
  }
  if (field === 'scale') {
    calloutsActions.updateInstance(
      inst.id,
      { scale: clamp(inst.scale + dir * SCALE_STEP, 0.1, 10) },
      `hk-scale:${inst.id}`,
    );
    return;
  }
  const textScale = clamp((inst.textScale ?? 1) + dir * SCALE_STEP, TEXT_SCALE_MIN, TEXT_SCALE_MAX);
  calloutsActions.updateInstance(inst.id, { textScale }, `hk-text:${inst.id}`);
}

function bumpSlideIn(field: 'distance' | 'duration', dir: -1 | 1): void {
  const s = animationUiState.get().slideIn;
  const next =
    field === 'distance'
      ? { distance: clamp(s.distance + dir * DISTANCE_STEP, 0, 1000) }
      : { duration: clamp(s.duration + dir * DURATION_STEP, 0.1, 600) };
  animationUiActions.set({ slideIn: { ...s, ...next } });
}

function bumpStepCardText(dir: -1 | 1): void {
  const id = pickedStepId();
  const card = id ? activeScene()?.steps.find((s) => s.id === id)?.card : null;
  if (id && card) {
    const textScale = clamp((card.textScale ?? 1) + dir * SCALE_STEP, TEXT_SCALE_MIN, TEXT_SCALE_MAX);
    stepsActions.setCard(id, { ...card, textScale }, `hk-step-text:${id}`);
  }
}

function addOverlay(component: string): void {
  void calloutsActions.addDesign(component);
}

/** One − / + pair (codes: dec, inc). */
function stepper(
  id: string,
  codes: readonly [number, number],
  label: string,
  step: (dir: -1 | 1) => void,
): HotkeyDef[] {
  return ([-1, 1] as const).map((dir, i) => ({
    id: `${id}.${dir < 0 ? 'dec' : 'inc'}`,
    category: CATEGORY,
    label: `${label} ${dir < 0 ? '−' : '+'}`,
    defaultKeys: `ALT ${codes[i]}`,
    description: `${label}: one step ${dir < 0 ? 'down' : 'up'}.`,
    run: () => step(dir),
    context: authoring,
  }));
}

/** One authoring command. */
function cmd(id: string, code: number, label: string, description: string, run: () => void): HotkeyDef {
  return { id, category: CATEGORY, label, defaultKeys: `ALT ${code}`, description, run, context: authoring };
}

// -----------------------------------------------------------------------------
// table
// -----------------------------------------------------------------------------

/** Key panel and Timeline shortcuts. */
export const ANIMATION_KEY_HOTKEYS: HotkeyDef[] = [
  cmd('animation.hideFromHere', 1507, 'Hide from here', 'The current object hidden from the time slider on.', () => {
    const id = currentObject();
    if (id) {
      keysActions.instantFromHere([id], { visible: false });
    }
  }),
  cmd('animation.showFromHere', 1508, 'Show from here', 'The current object shown from the time slider on.', () => {
    const id = currentObject();
    if (id) {
      keysActions.instantFromHere([id], { visible: true });
    }
  }),
  cmd(
    'animation.slideIn',
    1509,
    'Slide in',
    "The current object slides in from the time slider (the Key panel's settings).",
    () => {
      const id = currentObject();
      if (id) {
        objectsActions.slideInWithSettings(id);
      }
    },
  ),
  cmd('animation.slideIn.direction', 1548, 'Slide in: next side', 'The side Slide in comes from: the next one.', () => {
    const s = animationUiState.get().slideIn;
    const i = SLIDE_DIRECTIONS.findIndex((d) => d.value === s.dir);
    animationUiActions.set({ slideIn: { ...s, dir: SLIDE_DIRECTIONS[(i + 1) % SLIDE_DIRECTIONS.length].value } });
  }),
  ...stepper('animation.slideIn.distance', [1544, 1545], 'Slide in distance', (d) => bumpSlideIn('distance', d)),
  ...stepper('animation.slideIn.duration', [1546, 1547], 'Slide in time', (d) => bumpSlideIn('duration', d)),
  cmd(
    'animation.gizmo.move',
    1510,
    'Move gizmo',
    'The move gizmo on the current object — drag to pose, then Key.',
    () => void posingActions.gizmo('move'),
  ),
  cmd(
    'animation.gizmo.rotate',
    1511,
    'Rotate gizmo',
    'The rotate gizmo on the current object — drag to pose, then Key.',
    () => void posingActions.gizmo('rotate'),
  ),
  cmd(
    'animation.pose.discard',
    1524,
    'Discard the pose',
    'Put the posed objects back where their keys have them.',
    () => void posingActions.discardPose(),
  ),
  cmd('animation.pingPong', 1512, 'Ping-pong', 'Toggle: at the end the scene plays back to the start.', () =>
    scenesActions.togglePingPong(),
  ),
  cmd('animation.end.pin', 1519, 'Pin the end here', 'The scene ends at the time slider.', () =>
    scenesActions.pinEndHere(),
  ),
  cmd('animation.end.unpin', 1520, 'Unpin the end', 'The scene ends at its last key, step or overlay again.', () =>
    scenesActions.setEnd(null),
  ),
  cmd(
    'animation.addStep',
    1513,
    'Add a step',
    'A step from the time slider to the next step (or 5 s).',
    () => void stepsActions.addAtSlider(),
  ),
  cmd(
    'animation.step.pauseAtEnd',
    1514,
    'Step: pause at its end',
    'Toggle: playback waits at the end of the picked step.',
    () => {
      const id = pickedStepId();
      if (id) {
        stepsActions.togglePause(id);
      }
    },
  ),
  cmd('animation.step.remove', 1515, 'Delete the step', 'Delete the picked step (the objects’ keys stay).', () => {
    const id = pickedStepId();
    if (id) {
      stepsActions.remove(id);
    }
  }),
  cmd(
    'animation.step.card.scene',
    1539,
    "Step: the scene's card",
    "The picked step shows the scene's step card.",
    () => {
      const id = pickedStepId();
      if (id) {
        stepsActions.setCard(id, undefined);
      }
    },
  ),
  cmd('animation.step.card.own', 1540, 'Step: a card of its own', 'The picked step gets a card of its own.', () => {
    const id = pickedStepId();
    if (id) {
      stepsActions.setCard(id, { component: activeScene()?.stepCard?.component ?? PRESET_STEP_CARD.id, values: {} });
    }
  }),
  cmd('animation.step.card.none', 1541, 'Step: no card', 'The picked step shows no card.', () => {
    const id = pickedStepId();
    if (id) {
      stepsActions.setCard(id, null);
    }
  }),
  ...stepper('animation.step.cardText', [1542, 1543], 'Step card text size', bumpStepCardText),
  cmd('animation.interp.smooth', 1516, 'Arrive smooth', 'The picked keys (else the next key) ease in and out.', () =>
    setInterp('smooth'),
  ),
  cmd(
    'animation.interp.linear',
    1517,
    'Arrive linear',
    'The picked keys (else the next key) arrive at an even speed.',
    () => setInterp('linear'),
  ),
  cmd(
    'animation.interp.hold',
    1518,
    'Hold, then jump',
    'The picked keys (else the next key) hold, then jump at the key.',
    () => setInterp('hold'),
  ),
  cmd('animation.object.mute', 1521, 'Object: mute', 'Toggle: the current object is not animated.', () => {
    const id = currentObject();
    if (id) {
      objectsActions.toggleMuted(id);
    }
  }),
  cmd(
    'animation.object.pivot.bottom',
    1522,
    'Object: pivot at the bottom',
    'The current object turns about the centre of its base.',
    () => {
      const id = currentObject();
      if (id) {
        objectsActions.setPivot(id, 'bottom');
      }
    },
  ),
  cmd(
    'animation.object.pivot.next',
    1523,
    'Object: next pivot',
    "The current object's pivot: the next side of its box (centre, bottom, top, front, back, left, right).",
    () => {
      const id = currentObject();
      const o = id ? keysActions.object(id) : null;
      if (id && o) {
        const i = Array.isArray(o.pivot) ? -1 : PIVOT_ANCHORS.indexOf(o.pivot);
        objectsActions.setPivot(id, PIVOT_ANCHORS[(i + 1) % PIVOT_ANCHORS.length]);
      }
    },
  ),
  cmd(
    'animation.key.visible',
    1382,
    'Key: shown / hidden',
    'The picked key: shown, hidden, or as before (cycles).',
    () => patchKey((k) => ({ visible: k.visible === undefined ? false : k.visible ? undefined : true }), 'hk-vis'),
  ),
  cmd(
    'animation.key.visible.same',
    1525,
    'Key: visibility as before',
    'The picked key does not change the visibility.',
    () => patchKey(() => ({ visible: undefined }), 'hk-vis'),
  ),
  cmd('animation.key.color.same', 1526, 'Key: colour as before', 'The picked key does not change the colour.', () =>
    patchKey(() => ({ color: undefined }), 'hk-color'),
  ),
  cmd(
    'animation.key.opacity',
    1527,
    'Key: set opacity',
    'Toggle: the picked key sets the opacity (else as before).',
    () => patchKey((k) => ({ opacity: k.opacity === undefined ? 0.5 : undefined }), 'hk-op'),
  ),
  ...stepper('animation.key.opacity', [1383, 1384], 'Key opacity', (dir) =>
    patchKey(
      (k) => (k.opacity === undefined ? null : { opacity: clamp(k.opacity + dir * OPACITY_STEP, 0, 1) }),
      'hk-op',
    ),
  ),
  cmd('animation.key.spin', 1385, 'Key: spin', 'Toggle: the picked key turns a full turn on the way to it.', () =>
    patchKey((k) => ({ spin: k.spin ? undefined : { axis: [0, 0, 1], degrees: 360 } }), 'hk-spin'),
  ),
  ...stepper('animation.key.spinDegrees', [1386, 1387], 'Key spin degrees', (dir) =>
    patchKey(
      (k) => (k.spin ? { spin: { axis: k.spin.axis, degrees: k.spin.degrees + dir * SPIN_STEP } } : null),
      'hk-spin',
    ),
  ),
  cmd(
    'animation.cameraKey.glide',
    1408,
    'Camera keys: glide',
    'The picked camera keys glide in, easing in and out.',
    () => {
      const k = pickedKeys((r) => r === '@camera');
      if (k) {
        keysActions.setInterp(k.row, k.indices, 'smooth');
      }
    },
  ),
  cmd('animation.cameraKey.even', 1528, 'Camera keys: even', 'The picked camera keys arrive at an even speed.', () => {
    const k = pickedKeys((r) => r === '@camera');
    if (k) {
      keysActions.setInterp(k.row, k.indices, 'linear');
    }
  }),
  cmd('animation.cameraKey.cut', 1409, 'Camera keys: cut', 'The view jumps to the picked camera keys.', () => {
    const k = pickedKeys((r) => r === '@camera');
    if (k) {
      keysActions.setInterp(k.row, k.indices, 'hold');
    }
  }),
  cmd(
    'animation.cameraKey.take',
    1529,
    'Camera key: take this view',
    'The picked camera key takes the view now.',
    () => {
      const k = pickedKeys((r) => r === '@camera');
      if (k?.indices[0] !== undefined) {
        keysActions.setCameraView(k.indices[0]);
      }
    },
  ),
  cmd('animation.cameraKey.goto', 1530, 'Camera key: go there', 'Look through the picked camera key.', () => {
    const k = pickedKeys((r) => r === '@camera');
    const key = k?.indices[0] !== undefined ? activeScene()?.camera[k.indices[0]] : undefined;
    const r = runtimeRenderer();
    if (key && r) {
      playerActions.seek(key.t);
      flyCameraTo(r, key.view);
    }
  }),
  cmd(
    'animation.sectionKeys.glide',
    1343,
    'Clipping keys: glide',
    'The clipping glides to the picked clipping keys.',
    () => {
      const k = pickedKeys((r) => r === '@section');
      if (k) {
        keysActions.setInterp(k.row, k.indices, 'smooth');
      }
    },
  ),
  cmd(
    'animation.sectionKeys.even',
    1531,
    'Clipping keys: even',
    'The clipping moves to the picked keys at an even speed.',
    () => {
      const k = pickedKeys((r) => r === '@section');
      if (k) {
        keysActions.setInterp(k.row, k.indices, 'linear');
      }
    },
  ),
  cmd(
    'animation.sectionKeys.switch',
    1344,
    'Clipping keys: switch',
    'The clipping switches at the picked clipping keys.',
    () => {
      const k = pickedKeys((r) => r === '@section');
      if (k) {
        keysActions.setInterp(k.row, k.indices, 'hold');
      }
    },
  ),
  cmd(
    'animation.sectionKey.take',
    1532,
    'Clipping key: take this clipping',
    'The picked clipping key takes the clipping now.',
    () => {
      const k = pickedKeys((r) => r === '@section');
      if (k?.indices[0] !== undefined) {
        keysActions.setSectionValue(k.indices[0]);
      }
    },
  ),
  cmd(
    'animation.sectionKey.goto',
    1533,
    'Clipping key: go there',
    'The time slider to the picked clipping key.',
    () => {
      const k = pickedKeys((r) => r === '@section');
      const key = k?.indices[0] !== undefined ? activeScene()?.section[k.indices[0]] : undefined;
      if (key) {
        playerActions.seek(key.t);
      }
    },
  ),
  ...(['reset', 'append', 'hide'] as const).map((mode, i) =>
    cmd(
      `animation.rules.mode.${mode}`,
      1534 + i,
      `Colour rules: ${mode}`,
      `The Key panel's colour rules (the picked key or the next one) in mode ${mode}.`,
      () => rulesEditorActions.setMode(mode),
    ),
  ),
  cmd(
    'animation.rules.update',
    1537,
    'Colour rules: from Set Color',
    "The Set Color panel's rules into the Key panel — the picked key takes them, else the next rules key.",
    () => rulesEditorActions.fromSetColor(),
  ),
  cmd('animation.rules.open', 1538, 'Open Set Color', 'Open the Set Color panel, where colour rules are built.', () =>
    openAnimationPanel('multiColor'),
  ),
  cmd(
    'animation.addCallout',
    942,
    '+ Callout',
    'A label hanging from the selected object, from the time slider for 3 s.',
    () => void calloutsActions.addForSelection(),
  ),
  cmd('animation.overlay.add', 1345, 'Add a caption', 'A caption on screen, from the time slider for 3 s.', () =>
    addOverlay(PRESET_CAPTION.id),
  ),
  cmd(
    'animation.overlay.title',
    1346,
    'Add a title card',
    'A title card on screen, from the time slider for 3 s.',
    () => addOverlay(PRESET_TITLE.id),
  ),
  cmd(
    'animation.overlay.info',
    1347,
    'Add an info card',
    'An info card (text and image) on screen, from the time slider for 3 s.',
    () => addOverlay(PRESET_INFO_IMAGE.id),
  ),
  cmd(
    'animation.overlay.stepCard',
    1348,
    'Add a step card',
    'A step card on screen, from the time slider for 3 s.',
    () => addOverlay(PRESET_STEP_CARD.id),
  ),
  cmd(
    'animation.overlay.warning',
    1663,
    'Add a warning banner',
    'A warning banner on screen, from the time slider for 3 s.',
    () => addOverlay(PRESET_WARNING.id),
  ),
  cmd(
    'animation.overlay.keyHere',
    1338,
    'Overlay: key its place',
    'A position key of the picked overlay at the time slider.',
    () => {
      const p = animationUiState.get().picked;
      if (p.kind === 'callout') {
        calloutsActions.keyHere(p.id);
      }
    },
  ),
  cmd(
    'animation.overlay.clearKeys',
    1339,
    'Overlay: clear its place keys',
    'The picked overlay keeps one place.',
    () => {
      const p = animationUiState.get().picked;
      if (p.kind === 'callout') {
        calloutsActions.clearKeys(p.id);
      }
    },
  ),
  cmd('animation.overlay.remove', 1388, 'Overlay: delete', 'Delete the picked overlay.', () => {
    const p = animationUiState.get().picked;
    if (p.kind === 'callout') {
      calloutsActions.remove(p.id);
    }
  }),
  cmd(
    'animation.overlay.editStyle',
    976,
    'Overlay: edit its design',
    "Open the picked overlay's design in the Overlay Editor.",
    () => {
      const id = pickedInstance();
      if (id) {
        overlayEditorActions.editInstanceStyle(id);
      }
    },
  ),
  cmd(
    'animation.overlay.detach',
    977,
    'Overlay: detach its design',
    'Give the picked overlay its own copy of its design.',
    () => {
      const id = pickedInstance();
      if (id) {
        overlayEditorActions.detach(id);
      }
    },
  ),
  ...stepper('animation.overlay.scale', [1389, 1390], 'Overlay size', (d) => bumpInstance('scale', d)),
  ...stepper('animation.overlay.textScale', [1395, 1396], 'Overlay text size', (d) => bumpInstance('textScale', d)),
];
