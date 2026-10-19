// The Animation category of the shortcut table (DESIGN.md › Animation),
// kept beside bindings.ts, which spreads it into HOTKEYS. Codes in the ALT
// 9xx / 13xx / 14xx blocks are ASSIGNED and never renumbered; new commands
// take codes from ALT 1505 (see animationKeyBindings.ts). Bare letters are
// avoided where the camera owns them (WASD/QE); K / R / Space-tap and
// SHIFT+J / SHIFT+L are the deliberate exceptions, guarded by `context`.
// I (Key) is not in the table: posing.actions.ts listens for it while
// authoring, and the viewer's I (Invert selection, bindings.ts) is off then
// by its `context` — both listeners sit on window capture, so the table's
// claim could not stop the other one.

import type { HotkeyDef } from '@treDeSpaceUI/hotkeys';
import { toast, zoomTimelineView } from '@treDeSpaceUI/widgets';
import {
  type AnimationPanelId,
  isAnimationPanelOpen,
  openAnimationPanel,
} from '../components/panels/animation/animationPanels';
import { animationDocActions } from '../state/animation/animationDoc.actions';
import { animationFileActions } from '../state/animation/animationFile.actions';
import { animationUiActions } from '../state/animation/animationUi.actions';
import { animationUiState } from '../state/animation/animationUi.state';
import { keysActions } from '../state/animation/keys.actions';
import { objectsActions } from '../state/animation/objects.actions';
import { playerActions } from '../state/animation/player.actions';
import { playerState } from '../state/animation/player.state';
import { posingActions } from '../state/animation/posing.actions';
import { presentActions } from '../state/animation/present.actions';
import { goToFirstProblem } from '../state/animation/problems';
import { rowObject } from '../state/animation/rows';
import { rulesEditorActions } from '../state/animation/rulesEditor.actions';
import { currentView } from '../state/animation/runtime';
import { scenesActions } from '../state/animation/scenes.actions';
import { stepsActions } from '../state/animation/steps.actions';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const CATEGORY = 'Animation';
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
const ZOOM_STEP = 1.25;
/** Panels that put an animation in view: K plays from them with the mode off. */
const PLAY_PANELS: readonly AnimationPanelId[] = ['animation', 'animationTimeline'];

// -----------------------------------------------------------------------------
// guards + helpers
// -----------------------------------------------------------------------------

const inMode = () => playerState.get().status !== 'off';
const authoring = () => animationUiActions.isAuthoring();
const paused = () => playerState.get().status === 'paused' || playerState.get().status === 'waiting';
/** In the mode, or an animation panel is open — a stray K anywhere else would
 *  enter the mode and its clean start. */
const nearAnimation = () => inMode() || PLAY_PANELS.some((id) => isAnimationPanelOpen(id));

function stepSpeed(dir: 1 | -1): void {
  const cur = playerState.get().speed;
  const i = SPEEDS.findIndex((s) => s >= cur - 1e-6);
  const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? SPEEDS.length - 1 : i) + dir))];
  playerActions.setSpeed(next);
}

/** Play / pause, entering the mode first when it is off (authoring in the
 *  Timeline's workspace, else playback). */
function playPause(): void {
  if (!inMode()) {
    void animationUiActions.ensureMode().then((ok) => ok && playerActions.play());
    return;
  }
  playerActions.togglePlay();
}

/** Run with the current object row's id. */
const onCurrentObject = (fn: (id: string) => void) => () => {
  const id = rowObject(animationUiState.get().current);
  if (id) {
    fn(id);
  } else {
    toast.info('Pick an object row in the Timeline first.');
  }
};

function zoom(factor: number): void {
  animationUiActions.set({ view: zoomTimelineView(animationUiState.get().view, factor, 0) });
}

// -----------------------------------------------------------------------------
// table
// -----------------------------------------------------------------------------

/** Mode, playback and file shortcuts. */
export const ANIMATION_PLAYER_HOTKEYS: HotkeyDef[] = [
  {
    id: 'animation.toggleMode',
    category: CATEGORY,
    label: 'Animate on / off',
    defaultKeys: 'ALT 901',
    description: 'Enter or leave animation authoring — the scene is restored exactly when you leave.',
    run: () => void animationUiActions.toggleMode(),
  },
  {
    id: 'animation.exitMode',
    category: CATEGORY,
    label: 'Close animation',
    defaultKeys: 'ALT 903',
    description:
      'Leave animation mode (playing or authoring) — animated items go back to where they were; from presenting, back to the panels and mode from before.',
    run: () => void presentActions.close(),
    context: inMode,
  },
  {
    id: 'animation.playPause',
    category: CATEGORY,
    label: 'Play / pause',
    defaultKeys: 'K',
    description: 'Play, pause or continue the animation (with the mode off: while an animation panel is open).',
    run: playPause,
    context: nearAnimation,
  },
  {
    id: 'animation.playPauseSpace',
    category: CATEGORY,
    label: 'Play / pause (Space tap)',
    defaultKeys: 'SPACE',
    description:
      'A clean tap of Space plays or pauses while animation mode is on. Space held + click still flies the camera.',
    trigger: 'tap',
    run: () => playerActions.togglePlay(),
    context: inMode,
  },
  {
    id: 'animation.stop',
    category: CATEGORY,
    label: 'Stop',
    defaultKeys: 'ALT 904',
    description: 'Stop and go to the start.',
    run: () => playerActions.stop(),
    context: inMode,
  },
  {
    id: 'animation.prevStep',
    category: CATEGORY,
    label: 'Previous step',
    defaultKeys: 'SHIFT+J',
    description: 'The time slider to the start of the previous step (paused there).',
    run: () => playerActions.prevStep(),
    context: inMode,
  },
  {
    id: 'animation.nextStep',
    category: CATEGORY,
    label: 'Next step',
    defaultKeys: 'SHIFT+L',
    description: 'The time slider to the start of the next step (paused there).',
    run: () => playerActions.nextStep(),
    context: inMode,
  },
  {
    id: 'animation.replayStep',
    category: CATEGORY,
    label: 'Replay step',
    defaultKeys: 'ALT 905',
    description: 'Play the step at the time slider again from its start.',
    run: () => playerActions.replayStep(),
    context: inMode,
  },
  {
    id: 'animation.playStep',
    category: CATEGORY,
    label: 'Play step',
    defaultKeys: 'ALT 906',
    description: 'Play the step at the time slider (or the picked one) and stop at its end.',
    run: () => {
      const p = animationUiState.get().picked;
      const id = p.kind === 'step' ? p.id : (stepsActions.atSlider()?.id ?? null);
      if (id) {
        playerActions.playStep(id);
      }
    },
    context: inMode,
  },
  {
    id: 'animation.toggleLoop',
    category: CATEGORY,
    label: 'Loop',
    defaultKeys: 'ALT 909',
    description: 'Toggle: the scene starts again at its end.',
    run: () => scenesActions.toggleLoop(),
    context: inMode,
  },
  {
    id: 'animation.speed.inc',
    category: CATEGORY,
    label: 'Speed up',
    defaultKeys: 'ALT 910',
    description: 'Faster playback (0.25× … 4×).',
    run: () => stepSpeed(1),
  },
  {
    id: 'animation.speed.dec',
    category: CATEGORY,
    label: 'Slow down',
    defaultKeys: 'ALT 911',
    description: 'Slower playback.',
    run: () => stepSpeed(-1),
  },
  {
    id: 'animation.returnCamera',
    category: CATEGORY,
    label: 'Return to animation view',
    defaultKeys: 'R',
    description: "Blend the camera back to the camera keys' view after you moved it.",
    run: () => playerActions.returnCamera(),
    context: () => inMode() && playerState.get().camera === 'free',
  },
  {
    id: 'animation.continue',
    category: CATEGORY,
    label: 'Continue',
    defaultKeys: 'ALT 912',
    description: 'Go on from a pause (the end of a step that pauses there).',
    run: () => playerActions.continue(),
    context: paused,
  },
  {
    id: 'animation.toggleOverlays',
    category: CATEGORY,
    label: 'Overlays on / off',
    defaultKeys: 'ALT 921',
    description: 'Show or hide the 2D overlays (step cards, callouts).',
    run: () => playerActions.toggleOverlays(),
  },
  {
    id: 'animation.scene.next',
    category: CATEGORY,
    label: 'Next scene',
    defaultKeys: 'ALT 924',
    description: 'Work on / play the next scene of the animation.',
    run: () => playerActions.nextScene(),
  },
  {
    id: 'animation.file.open',
    category: CATEGORY,
    label: 'Open animation…',
    defaultKeys: 'ALT 925',
    description: 'Open an animation file (*.tdanim.json).',
    run: () => void animationFileActions.open(),
  },
  {
    id: 'animation.file.save',
    category: CATEGORY,
    label: 'Save animation',
    defaultKeys: 'ALT 926',
    description: 'Download the animation (the overlay designs it uses included).',
    run: () => animationFileActions.save(),
  },
  {
    id: 'animation.file.new',
    category: CATEGORY,
    label: 'New animation',
    defaultKeys: 'ALT 960',
    description: 'Start a new, empty animation.',
    run: () => void animationFileActions.newAnimation(),
  },
  {
    id: 'animation.draft.recover',
    category: CATEGORY,
    label: 'Recover unsaved animation',
    defaultKeys: 'ALT 981',
    description: 'Restore the animation autosaved in an earlier session.',
    run: () => void animationFileActions.recoverDraft(),
  },
  {
    id: 'animation.draft.discard',
    category: CATEGORY,
    label: 'Discard unsaved animation',
    defaultKeys: 'ALT 982',
    description: 'Throw away the autosaved animation draft.',
    run: () => void animationDocActions.discardDraft(),
  },
  {
    id: 'animation.problem.goto',
    category: CATEGORY,
    label: 'Go to the first problem',
    defaultKeys: 'ALT 988',
    description: 'Open the Key panel and pick what its first problem is about.',
    run: () => {
      openAnimationPanel('animation');
      if (!goToFirstProblem()) {
        toast.info("No problems — every object's items are found and nothing moves while hidden.");
      }
    },
  },
  {
    id: 'animation.undo',
    category: CATEGORY,
    label: 'Undo animation edit',
    defaultKeys: 'CTRL+Z',
    description: 'Undo the last animation edit (while authoring).',
    run: () => animationDocActions.undo(),
    context: authoring,
  },
  {
    id: 'animation.redo',
    category: CATEGORY,
    label: 'Redo animation edit',
    defaultKeys: 'CTRL+Y',
    description: 'Redo the last undone animation edit (while authoring).',
    run: () => animationDocActions.redo(),
    context: authoring,
  },
  {
    id: 'animation.playRange',
    category: CATEGORY,
    label: 'Play the in / out range',
    defaultKeys: 'ALT 1306',
    description: 'Play the Timeline’s in / out range (Shift+drag on the ruler sets it).',
    run: () => {
      const r = animationUiState.get().range;
      if (r) {
        playerActions.play({ kind: 'range', from: r.from, to: r.to });
      }
    },
    context: inMode,
  },
  {
    id: 'animation.toggleSnap',
    category: CATEGORY,
    label: 'Timeline snap',
    defaultKeys: 'ALT 1308',
    description: 'Toggle snapping to keys, step edges and the grid.',
    run: () => animationUiActions.toggleSnap(),
  },
  {
    id: 'animation.zoomIn',
    category: CATEGORY,
    label: 'Timeline zoom in',
    defaultKeys: 'ALT 1309',
    description: 'Zoom the Timeline in.',
    run: () => zoom(ZOOM_STEP),
  },
  {
    id: 'animation.zoomOut',
    category: CATEGORY,
    label: 'Timeline zoom out',
    defaultKeys: 'ALT 1310',
    description: 'Zoom the Timeline out.',
    run: () => zoom(1 / ZOOM_STEP),
  },
  {
    id: 'animation.togglePaths',
    category: CATEGORY,
    label: 'Motion paths',
    defaultKeys: 'ALT 956',
    description: 'Show the paths of the moving objects in the 3D view — or not.',
    run: () => animationUiActions.togglePaths(),
  },
  {
    id: 'animation.gotoStart',
    category: CATEGORY,
    label: 'Time slider to the start',
    defaultKeys: 'ALT 1505',
    description: 'The time slider to 0 (Home on the Timeline).',
    run: () => playerActions.seek(0),
    context: inMode,
  },
  {
    id: 'animation.gotoEnd',
    category: CATEGORY,
    label: 'Time slider to the end',
    defaultKeys: 'ALT 1506',
    description: 'The time slider to the end of the scene (End on the Timeline).',
    run: () => playerActions.seek(currentView()?.duration ?? 0),
    context: inMode,
  },
];

/** Objects, keys and the scene rows (authoring). */
export const ANIMATION_AUTHOR_HOTKEYS: HotkeyDef[] = [
  {
    id: 'animation.object.add',
    category: CATEGORY,
    label: '+ Object from the selection',
    defaultKeys: 'ALT 961',
    description: 'The selection as an object, with a key at the time slider holding where it stands.',
    run: () => void objectsActions.fromSelection({ key: true }),
    context: authoring,
  },
  {
    id: 'animation.object.select',
    category: CATEGORY,
    label: 'Object: select its items',
    defaultKeys: 'ALT 962',
    description: "Select the current object's items in the 3D view and the Hierarchy.",
    run: onCurrentObject((id) => void objectsActions.selectItems(id)),
    context: authoring,
  },
  {
    id: 'animation.object.pivotFromGizmo',
    category: CATEGORY,
    label: 'Object: pivot from the gizmo',
    defaultKeys: 'ALT 1352',
    description: "The current object turns about the Transform ribbon's locked pivot.",
    run: onCurrentObject((id) => objectsActions.pivotFromGizmo(id)),
    context: authoring,
  },
  {
    id: 'animation.object.update',
    category: CATEGORY,
    label: 'Object: update from selection',
    defaultKeys: 'ALT 1353',
    description: "The current object's items become the selection's — every key stays.",
    run: onCurrentObject((id) => void objectsActions.updateFromSelection(id)),
    context: authoring,
  },
  {
    id: 'animation.object.remove',
    category: CATEGORY,
    label: 'Object: delete',
    defaultKeys: 'ALT 1354',
    description: 'Delete the current object and its keys (its items stay where the model has them).',
    run: onCurrentObject((id) => objectsActions.remove(id)),
    context: authoring,
  },
  {
    id: 'animation.object.pivot.center',
    category: CATEGORY,
    label: 'Object: pivot at the centre',
    defaultKeys: 'ALT 1380',
    description: "The current object turns about its items' centre.",
    run: onCurrentObject((id) => objectsActions.setPivot(id, 'center')),
    context: authoring,
  },
  {
    id: 'animation.addKey',
    category: CATEGORY,
    label: 'Key',
    defaultKeys: 'ALT 943',
    description:
      'Key the current row at the time slider: the pose, the view, the clipping, the colour rules, the labels or measurements, or a new step (I while authoring).',
    run: () => void posingActions.key(),
    context: authoring,
  },
  {
    id: 'animation.deleteKey',
    category: CATEGORY,
    label: 'Delete the picked keys',
    defaultKeys: 'ALT 944',
    description: 'Delete the keys picked in the Timeline (Delete on the Timeline).',
    run: () => keysActions.deletePicked(),
    context: authoring,
  },
  {
    id: 'animation.prevKey',
    category: CATEGORY,
    label: 'Previous key',
    defaultKeys: 'ALT 945',
    description: 'The time slider to the previous key of the current row (of every row when none is current).',
    run: () => keysActions.stepKey(-1),
    context: inMode,
  },
  {
    id: 'animation.nextKey',
    category: CATEGORY,
    label: 'Next key',
    defaultKeys: 'ALT 946',
    description: 'The time slider to the next key of the current row (of every row when none is current).',
    run: () => keysActions.stepKey(1),
    context: inMode,
  },
  {
    id: 'animation.toggleAutoKey',
    category: CATEGORY,
    label: 'Auto-key',
    defaultKeys: 'ALT 947',
    description: 'Toggle: every gizmo drag keys at the time slider straight away (a red frame shows it).',
    run: () => animationUiActions.toggleAutoKey(),
    context: authoring,
  },
  {
    id: 'animation.cameraKey',
    category: CATEGORY,
    label: 'Key the view',
    defaultKeys: 'ALT 948',
    description: 'The view now as a camera key at the time slider.',
    run: () => keysActions.keyCamera(),
    context: authoring,
  },
  {
    id: 'animation.sectionKey',
    category: CATEGORY,
    label: 'Key the clipping',
    defaultKeys: 'ALT 1341',
    description: 'The clipping now (box, planes, shapes) as a clipping key at the time slider.',
    run: () => keysActions.keySection(),
    context: authoring,
  },
  {
    id: 'animation.rulesKey',
    category: CATEGORY,
    label: 'Key the colour rules',
    defaultKeys: 'ALT 1323',
    description: "The Key panel's colour rules (the next rules key) as a key at the time slider.",
    run: () => keysActions.keyRules(),
    context: authoring,
  },
  {
    id: 'animation.rules.edit',
    category: CATEGORY,
    label: 'Colour rules: to Set Color',
    defaultKeys: 'ALT 1324',
    description: "The Key panel's colour rules into the Set Color panel (its Save / Load and the big list).",
    run: () => rulesEditorActions.toSetColor(),
    context: authoring,
  },
  {
    id: 'animation.colorFromHere',
    category: CATEGORY,
    label: 'Colour from here',
    defaultKeys: 'ALT 1326',
    description: "The current object's colour from the time slider on (the Key panel's colour).",
    run: onCurrentObject((id) => keysActions.instantFromHere([id], { color: animationUiState.get().keyColor })),
    context: authoring,
  },
  {
    id: 'animation.ownColorFromHere',
    category: CATEGORY,
    label: 'Own colour from here',
    defaultKeys: 'ALT 1327',
    description: 'The current object back to its own colour from the time slider on.',
    run: onCurrentObject((id) => keysActions.instantFromHere([id], { color: null })),
    context: authoring,
  },
  {
    id: 'animation.path.straight',
    category: CATEGORY,
    label: 'Object: straight path',
    defaultKeys: 'ALT 1336',
    description: 'The current object moves in straight lines between its keys.',
    run: onCurrentObject((id) => objectsActions.setPath(id, 'straight')),
    context: authoring,
  },
  {
    id: 'animation.path.smooth',
    category: CATEGORY,
    label: 'Object: smooth path',
    defaultKeys: 'ALT 1337',
    description: 'The current object moves on a curve through its keys.',
    run: onCurrentObject((id) => objectsActions.setPath(id, 'smooth')),
    context: authoring,
  },
  {
    id: 'animation.keys.copy',
    category: CATEGORY,
    label: 'Copy keys',
    defaultKeys: 'ALT 1402',
    description: 'Copy the picked keys (Ctrl+C on the Timeline).',
    run: () => keysActions.copyPicked(),
    context: authoring,
  },
  {
    id: 'animation.keys.paste',
    category: CATEGORY,
    label: 'Paste keys',
    defaultKeys: 'ALT 1403',
    description: 'Paste copied keys at the time slider into the current row (Ctrl+V on the Timeline).',
    run: () => keysActions.paste(),
    context: authoring,
  },
  {
    id: 'animation.preset.orbit',
    category: CATEGORY,
    label: 'Camera orbit',
    defaultKeys: 'ALT 1406',
    description: 'One turn around what the view looks at, as camera keys from the time slider (8 s).',
    run: () => keysActions.cameraOrbit(),
    context: authoring,
  },
  {
    id: 'animation.scene.new',
    category: CATEGORY,
    label: 'New scene',
    defaultKeys: 'ALT 1349',
    description: 'A new, empty scene in the animation.',
    run: () => void scenesActions.newSceneNamed(),
    context: authoring,
  },
  {
    id: 'animation.scene.delete',
    category: CATEGORY,
    label: 'Delete this scene',
    defaultKeys: 'ALT 1350',
    description: 'Delete the scene you work on (undoable) — the animation keeps at least one.',
    run: () => scenesActions.deleteScene(),
    context: authoring,
  },
  {
    id: 'animation.stepCards',
    category: CATEGORY,
    label: 'Step cards on / off',
    defaultKeys: 'ALT 978',
    description: 'Toggle: steps show the built-in step card (unless they have their own) — or no card.',
    run: () => scenesActions.toggleStepCards(),
    context: authoring,
  },
  {
    id: 'animation.overlaysOnScreen',
    category: CATEGORY,
    label: 'Keep labels on screen',
    defaultKeys: 'ALT 1340',
    description: 'Toggle: labels hanging from objects flip and clamp to stay inside the view.',
    run: () => scenesActions.toggleOverlaysOnScreen(),
    context: authoring,
  },
  {
    id: 'animation.inspector.close',
    category: CATEGORY,
    label: 'Key panel: back to the scene',
    defaultKeys: 'ALT 1372',
    description: 'Drop the pick: the Key panel shows the scene settings.',
    run: () => {
      animationUiActions.pick({ kind: 'none' });
      animationUiActions.setCurrent(null);
    },
    context: authoring,
  },
];
