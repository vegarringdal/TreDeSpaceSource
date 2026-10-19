// Timeline look and item-set shortcuts (DESIGN.md › Animation › Authoring):
// the current object's visibility / transparency from the time slider, quick
// colour-rules keys for the selection or the whole model, and the object's
// item set (add / leave out the selection, the closest group), the Key
// panel's colour-rules editor, a picked key's own pivot, the camera keys
// toggle, the host's bookmark button, Present, the key pivot and the Labels /
// Measurements rows, renaming a scene, objects made one per node, the
// hotkeys that open a button's menu and the object's other pivot sides.
// Codes are ASSIGNED (ALT 1553-1598; 1568 and 1569 retired); never renumber.

import type { HotkeyDef } from '@treDeSpaceUI/hotkeys';
import { toast } from '@treDeSpaceUI/widgets';
import { hasMenu, requestMenu } from '../components/panels/shared/menuRequests';
import { choiceOf, PIVOT_ANCHORS, type PivotChoice } from '../lib/animation/pivots';
import { animationUiActions } from '../state/animation/animationUi.actions';
import { animationUiState } from '../state/animation/animationUi.state';
import { annotationsActions } from '../state/animation/annotations.actions';
import { activeScene } from '../state/animation/docEdit';
import { hostBookmarkActions } from '../state/animation/hostBookmark.actions';
import { hostBookmarkState } from '../state/animation/hostBookmark.state';
import { keysActions } from '../state/animation/keys.actions';
import { objectItemsActions } from '../state/animation/objectItems.actions';
import { objectsActions } from '../state/animation/objects.actions';
import { playerActions } from '../state/animation/player.actions';
import { playerState } from '../state/animation/player.state';
import { posingActions } from '../state/animation/posing.actions';
import { presentActions } from '../state/animation/present.actions';
import { QUICK_TRANSPARENT, quickRulesActions, type SelectionRule } from '../state/animation/quickRules.actions';
import { rowObject } from '../state/animation/rows';
import { rulesEditorActions } from '../state/animation/rulesEditor.actions';
import { sessionRestBounds } from '../state/animation/runtime';
import { scenesActions } from '../state/animation/scenes.actions';

// -----------------------------------------------------------------------------
// constants + helpers
// -----------------------------------------------------------------------------

const CATEGORY = 'Animation';
const authoring = () => animationUiActions.isAuthoring();

/** The current object row's id (a toast when there is none). */
function currentObject(): string | null {
  const id = rowObject(animationUiState.get().current);
  if (!id) {
    toast.info('Pick an object row in the Timeline first.');
  }
  return id;
}

/** Runs `run` with the picked object key (a hint when none is picked). */
function withPickedKey(run: (id: string, index: number) => void): () => void {
  return () => {
    const p = animationUiState.get().picked;
    const id = p.kind === 'keys' ? rowObject(p.row) : null;
    const index = p.kind === 'keys' ? p.indices[0] : undefined;
    if (!id || index === undefined) {
      toast.info('Pick an object key in the Timeline first.');
      return;
    }
    run(id, index);
  };
}

/** Pivots the hotkey steps through. */
const PIVOT_ORDER: readonly PivotChoice['at'][] = ['object', ...PIVOT_ANCHORS];

/** The next side (offset from zero). */
function stepPivot(c: PivotChoice): PivotChoice {
  return { at: PIVOT_ORDER[(PIVOT_ORDER.indexOf(c.at) + 1) % PIVOT_ORDER.length], offset: [0, 0, 0] };
}

/** The picked key's pivot, else the next key's, changed by `step`. */
function changeKeyPivot(step: (c: PivotChoice) => PivotChoice): void {
  const p = animationUiState.get().picked;
  const id = p.kind === 'keys' ? rowObject(p.row) : null;
  const index = p.kind === 'keys' ? p.indices[0] : undefined;
  const key = id && index !== undefined ? keysActions.object(id)?.keys[index] : undefined;
  if (id && index !== undefined && key) {
    keysActions.setKeyPivotChoice(id, index, step(choiceOf(key.pivot, sessionRestBounds(id))));
    return;
  }
  const next = posingActions.nextKey();
  if (!next) {
    toast.info('Pick an object key, or an object row, first.');
    return;
  }
  posingActions.setNextPivot(
    step(animationUiState.get().nextPivot ?? choiceOf(next.pivot, sessionRestBounds(next.object))),
  );
}

/** Runs `run` with the current object, when there is one. */
function withObject(run: (id: string) => void): () => void {
  return () => {
    const id = currentObject();
    if (id) {
      run(id);
    }
  };
}

function cmd(id: string, code: number, label: string, description: string, run: () => void): HotkeyDef {
  return { id, category: CATEGORY, label, defaultKeys: `ALT ${code}`, description, run, context: authoring };
}

/** A hotkey that opens a button's menu where the button is (only while it
 *  is on screen). The menu's id is the hotkey's. */
function menuCmd(id: string, code: number, label: string, description: string): HotkeyDef {
  return {
    id,
    category: CATEGORY,
    label,
    defaultKeys: `ALT ${code}`,
    description,
    run: () => void requestMenu(id),
    context: () => hasMenu(id),
  };
}

function selectionRule(id: string, code: number, kind: SelectionRule, label: string, description: string): HotkeyDef {
  return cmd(id, code, label, description, () => void quickRulesActions.fromSelection(kind));
}

// -----------------------------------------------------------------------------
// table
// -----------------------------------------------------------------------------

/** Look, quick-rules, item-set and rules-editor shortcuts. */
export const ANIMATION_LOOK_HOTKEYS: HotkeyDef[] = [
  cmd(
    'animation.visible.toggle',
    1553,
    'Show / hide from here',
    'Toggle: the current object hidden (or shown again) from the time slider on.',
    withObject((id) => keysActions.toggleVisibleFromHere(id)),
  ),
  cmd(
    'animation.transparentFromHere',
    1554,
    'Transparent from here',
    `The current object at ${Math.round(QUICK_TRANSPARENT * 100)} % opacity from the time slider on.`,
    withObject((id) => keysActions.instantFromHere([id], { opacity: QUICK_TRANSPARENT })),
  ),
  cmd(
    'animation.opaqueFromHere',
    1555,
    'Opaque from here',
    'The current object fully opaque from the time slider on.',
    withObject((id) => keysActions.instantFromHere([id], { opacity: 1 })),
  ),
  selectionRule(
    'animation.rules.selectionColour',
    1556,
    'color',
    'Rules: colour the selection from here',
    'A colour-rules key at the time slider: the selected items in the key colour, on top of the rules before.',
  ),
  selectionRule(
    'animation.rules.selectionTransparent',
    1557,
    'transparent',
    'Rules: selection transparent from here',
    'A colour-rules key at the time slider: the selected items transparent, on top of the rules before.',
  ),
  selectionRule(
    'animation.rules.selectionHide',
    1558,
    'hide',
    'Rules: hide the selection from here',
    'A colour-rules key at the time slider: the selected items hidden, on top of the rules before.',
  ),
  selectionRule(
    'animation.rules.selectionOnly',
    1559,
    'isolate',
    'Rules: only the selection from here',
    'A colour-rules key at the time slider: everything but the selected items hidden.',
  ),
  cmd(
    'animation.rules.hideAll',
    1560,
    'Rules: hide everything from here',
    'A colour-rules key at the time slider hiding the whole model — objects with a Show key bring items in.',
    quickRulesActions.hideAll,
  ),
  cmd(
    'animation.rules.showAll',
    1561,
    "Rules: the model's own colours from here",
    'A colour-rules key at the time slider: a clean model again.',
    quickRulesActions.showAll,
  ),
  cmd(
    'animation.rules.editInForce',
    1562,
    'Rules: edit the rules in force',
    'Pick the colour-rules key in force at the time slider, so the Key panel edits it.',
    quickRulesActions.editInForce,
  ),
  cmd(
    'animation.object.addSelection',
    1563,
    'Object: add the selection',
    'The selected nodes join the current object (a node it leaves out comes back).',
    withObject((id) => void objectItemsActions.addSelection(id)),
  ),
  cmd(
    'animation.object.removeSelection',
    1564,
    'Object: remove the selection',
    'The selected nodes leave the current object — a node inside one of its groups is left out of it.',
    withObject((id) => void objectItemsActions.removeSelection(id)),
  ),
  cmd(
    'animation.object.closestGroup',
    1565,
    'Object: use the closest group',
    "The current object's items named as their closest group minus the few nodes not in it.",
    withObject((id) => void objectItemsActions.applyClosestGroup(id)),
  ),
  cmd(
    'animation.rules.addRule',
    1566,
    'Colour rules: add a rule',
    "A new rule at the end of the Key panel's colour rules (the picked key or the next one).",
    () => rulesEditorActions.addRule(),
  ),
  cmd(
    'animation.key.pivot.next',
    1574,
    'Key: next pivot',
    'The picked key (else the next key) turns about the next side of its box: as the object, centre, bottom, top, front, back, left, right.',
    () => changeKeyPivot(stepPivot),
  ),
  cmd(
    'animation.key.pivot.clear',
    1570,
    "Key: turn about the object's pivot",
    "The picked key turns about the object's pivot on the way in again.",
    withPickedKey((id, i) => keysActions.setKeyPivot(id, i, undefined)),
  ),
  {
    id: 'animation.toggleCameraFollow',
    category: CATEGORY,
    label: 'Camera keys: follow / orbit freely',
    defaultKeys: 'ALT 1571',
    description: 'Toggle: the view follows the camera keys, or you orbit freely.',
    run: playerActions.toggleCameraFollow,
    context: () => playerState.get().status !== 'off',
  },
  {
    id: 'animation.present',
    category: CATEGORY,
    label: 'Present the animation',
    defaultKeys: 'ALT 1573',
    description:
      'The 3D view alone with the floating play bar; Close on the play bar comes back to the panels and mode from before.',
    run: () => void presentActions.enter(),
  },
  {
    id: 'animation.bookmark',
    category: CATEGORY,
    label: 'Animation: host bookmark',
    defaultKeys: 'ALT 1572',
    description: 'Send the animation to the hosting page as a bookmark (button only shown when a host configured it).',
    run: hostBookmarkActions.clicked,
    context: () => hostBookmarkState.get().button !== null,
  },
  ...(['labels', 'measurements'] as const).flatMap((kind, i) => [
    cmd(
      kind === 'labels' ? 'animation.labelsKey' : 'animation.measurementsKey',
      1575 + i,
      `Key the ${kind}`,
      `The ${kind} on screen as a key at the time slider (the ${kind === 'labels' ? 'Labels' : 'Measurements'} row).`,
      () => annotationsActions.key(kind),
    ),
    cmd(
      `animation.${kind}.fromScene`,
      1577 + i,
      `${kind === 'labels' ? 'Labels' : 'Measurements'}: from the scene`,
      `The scene's own ${kind} (put aside while animating) on screen — Key keys them.`,
      () => annotationsActions.fromScene(kind),
    ),
    cmd(
      `animation.${kind}.none`,
      1579 + i,
      `${kind === 'labels' ? 'Labels' : 'Measurements'}: none from here`,
      `No ${kind} from the time slider on (a key with none).`,
      () => annotationsActions.none(kind),
    ),
  ]),
  cmd(
    'animation.scene.rename',
    1581,
    'Rename this scene',
    'The active scene gets a new name (asked in a prompt).',
    () => void scenesActions.renamePrompt(),
  ),
  cmd(
    'animation.objects.children',
    1582,
    '+ Objects: one per child',
    'One object for each child of every selected node (a group becomes its parts), each with a key at the time slider.',
    () => void objectsActions.fromSelectionParts('children'),
  ),
  cmd(
    'animation.objects.nodes',
    1583,
    '+ Objects: one per selected node',
    'One object for each selected node, each with a key at the time slider.',
    () => void objectsActions.fromSelectionParts('nodes'),
  ),
  menuCmd(
    'animation.menu.overlay',
    1585,
    'Overlay ▾ menu',
    "Open the Timeline's Overlay ▾ menu: a callout, title, caption, info card or step card from the time slider.",
  ),
  menuCmd(
    'animation.menu.overlayKey',
    1586,
    'Add an overlay ▾ menu',
    "Open the Key panel's Add an overlay ▾ menu (the Overlays row picked).",
  ),
  menuCmd(
    'animation.menu.export',
    1587,
    'Export ▾ menu',
    "Open the Timeline's Export ▾ menu: video, step stills and the brief for AI.",
  ),
  menuCmd(
    'animation.menu.scene',
    1588,
    'Scene ▾ menu',
    "Open the Timeline's Scene ▾ menu: switch, rename, add or delete a scene.",
  ),
  menuCmd(
    'animation.menu.playBarScene',
    1589,
    'Play bar: scene ▾ menu',
    "Open the play bar's scene menu (a scene to play).",
  ),
  menuCmd(
    'animation.menu.objectPivot',
    1590,
    'Pivot ▾ menu',
    "Open the Timeline's Pivot ▾ menu: what the current object turns about.",
  ),
  menuCmd(
    'overlay.menu.new',
    1591,
    'Overlay Editor: New ▾ menu',
    "Open the Overlay Editor's New ▾ menu (a design from a preset).",
  ),
  menuCmd(
    'overlay.menu.block',
    1592,
    'Overlay Editor: + Block ▾ menu',
    "Open the Overlay Editor's + Block ▾ menu (a block of a kind).",
  ),
  menuCmd('overlay.menu.export', 1593, 'Overlay Editor: Export ▾ menu', "Open the Overlay Editor's Export ▾ menu."),
  ...(['top', 'front', 'back', 'left', 'right'] as const).map((side, i) =>
    cmd(
      `animation.object.pivot.${side}`,
      1594 + i,
      `Object: pivot ${side}`,
      `The current object turns about the middle of the ${side} of its box (where it stands in the model); its keys stay where they are.`,
      withObject((id) => objectsActions.setPivot(id, side)),
    ),
  ),
  cmd(
    'animation.objects.selectAll',
    1584,
    'Objects: select them all',
    "Select every object's items — one gizmo drag then poses them all.",
    () => void objectsActions.selectObjects(activeScene()?.objects.map((o) => o.id) ?? []),
  ),
  cmd(
    'animation.rules.copyInForce',
    1567,
    'Colour rules: start from the rules in force',
    'The next rules key starts as the rules in force at the time slider, to change from here on.',
    () => rulesEditorActions.copyInForce(),
  ),
];
