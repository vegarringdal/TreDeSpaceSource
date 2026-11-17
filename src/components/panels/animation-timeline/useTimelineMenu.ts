import type { MenuEntry } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { calloutsActions } from '../../../state/animation/callouts.actions';
import { keyClipboardState } from '../../../state/animation/keyClipboard.state';
import { keysActions } from '../../../state/animation/keys.actions';
import { objectsActions } from '../../../state/animation/objects.actions';
import { playerActions } from '../../../state/animation/player.actions';
import { posingActions } from '../../../state/animation/posing.actions';
import { asRowId, isSetRow, type KeyRow, type RowId, rowObject } from '../../../state/animation/rows';
import { scenesActions } from '../../../state/animation/scenes.actions';
import { stepsActions } from '../../../state/animation/steps.actions';
import { objectsMenuItems } from './objectsMenu';
import { timelineEditActions } from './timelineEdit.actions';
import { parseItem, parsePoint } from './timelineIds';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

type Target = { kind: 'item' | 'row' | 'point' | 'empty'; id?: string; t: number };

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function objectEntries(id: string): MenuEntry[] {
  return [
    {
      id: 'hide',
      label: 'Hide from here',
      shortcut: 'animation.hideFromHere',
      onSelect: () => keysActions.instantFromHere([id], { visible: false }),
    },
    {
      id: 'show',
      label: 'Show from here',
      shortcut: 'animation.showFromHere',
      onSelect: () => keysActions.instantFromHere([id], { visible: true }),
    },
    {
      id: 'color',
      label: 'Colour from here',
      shortcut: 'animation.colorFromHere',
      onSelect: () => keysActions.instantFromHere([id], { color: animationUiState.get().keyColor }),
    },
    {
      id: 'own',
      label: 'Own colour from here',
      shortcut: 'animation.ownColorFromHere',
      onSelect: () => keysActions.instantFromHere([id], { color: null }),
    },
    {
      id: 'slide',
      label: 'Slide in from here',
      tooltip: 'With the Key panel’s Slide in settings',
      shortcut: 'animation.slideIn',
      onSelect: () => objectsActions.slideInWithSettings(id),
    },
    { separator: true },
    {
      id: 'select',
      label: 'Select its items',
      shortcut: 'animation.object.select',
      onSelect: () => void objectsActions.selectItems(id),
    },
    {
      id: 'update',
      label: 'Update from selection',
      shortcut: 'animation.object.update',
      onSelect: () => void objectsActions.updateFromSelection(id),
    },
    {
      id: 'mute',
      label: 'Mute / unmute',
      shortcut: 'animation.object.mute',
      onSelect: () => objectsActions.toggleMuted(id),
    },
    {
      id: 'remove',
      label: 'Delete object',
      danger: true,
      shortcut: 'animation.object.remove',
      onSelect: () => objectsActions.remove(id),
    },
  ];
}

function rowEntries(row: RowId): MenuEntry[] {
  const object = rowObject(row);
  const key: MenuEntry = {
    id: 'key',
    label: 'Key here',
    shortcut: 'animation.addKey',
    onSelect: () => void posingActions.key(),
  };
  if (object) {
    return [key, ...objectEntries(object)];
  }
  if (row === '@camera') {
    return [
      key,
      { id: 'orbit', label: 'Orbit from here', shortcut: 'animation.preset.orbit', onSelect: keysActions.cameraOrbit },
    ];
  }
  if (row === '@steps') {
    return [
      {
        id: 'step',
        label: 'Add a step here',
        shortcut: 'animation.addStep',
        onSelect: () => stepsActions.addAtSlider(),
      },
    ];
  }
  if (row === '@scene') {
    return [
      {
        id: 'rename',
        label: 'Rename this scene…',
        shortcut: 'animation.scene.rename',
        onSelect: () => void scenesActions.renamePrompt(),
      },
      { id: 'pin', label: 'Pin the end here', shortcut: 'animation.end.pin', onSelect: scenesActions.pinEndHere },
      {
        id: 'unpin',
        label: 'Unpin the end',
        shortcut: 'animation.end.unpin',
        onSelect: () => scenesActions.setEnd(null),
      },
    ];
  }
  if (row === '@objects') {
    return [
      {
        id: 'object',
        label: '+ Object from the selection',
        shortcut: 'animation.object.add',
        onSelect: () => void objectsActions.fromSelection({ key: true }),
      },
      ...objectsMenuItems(),
    ];
  }
  if (row === '@callouts') {
    return [
      {
        id: 'callout',
        label: 'Callout on the selection',
        shortcut: 'animation.addCallout',
        onSelect: () => void calloutsActions.addForSelection(),
      },
    ];
  }
  return [key];
}

function keyEntries(row: KeyRow, index: number): MenuEntry[] {
  const p = animationUiState.get().picked;
  const indices = p.kind === 'keys' && p.row === row && p.indices.includes(index) ? p.indices : [index];
  const interp = (i: 'smooth' | 'linear' | 'hold', label: string, shortcut: string): MenuEntry => ({
    id: i,
    label,
    shortcut,
    disabled: isSetRow(row),
    onSelect: () => keysActions.setInterp(row, indices, i),
  });
  return [
    { id: 'pick', label: 'Edit in the Key panel', onSelect: () => keysActions.pickKeys(row, indices) },
    interp('smooth', 'Arrive smooth', 'animation.interp.smooth'),
    interp('linear', 'Arrive linear', 'animation.interp.linear'),
    interp('hold', 'Hold, then jump', 'animation.interp.hold'),
    { separator: true },
    {
      id: 'copy',
      label: 'Copy',
      shortcut: 'animation.keys.copy',
      onSelect: () => {
        keysActions.pickKeys(row, indices);
        keysActions.copyPicked();
      },
    },
    {
      id: 'delete',
      label: indices.length > 1 ? `Delete ${indices.length} keys` : 'Delete key',
      danger: true,
      shortcut: 'animation.deleteKey',
      onSelect: () => keysActions.deleteKeys(row, indices),
    },
  ];
}

function entriesFor(target: Target): MenuEntry[] {
  const paste: MenuEntry = {
    id: 'paste',
    label: 'Paste keys here',
    shortcut: 'animation.keys.paste',
    disabled: !keyClipboardState.get().clip,
    onSelect: () => keysActions.paste(),
  };
  if (target.kind === 'row' && target.id) {
    const row = asRowId(target.id);
    if (row) {
      // an object already among those selected keeps the others selected
      const object = rowObject(row);
      if (object && animationUiState.get().objectSelection.includes(object)) {
        animationUiActions.setCurrent(row);
      } else {
        timelineEditActions.pickRow(row);
      }
      return [...rowEntries(row), { separator: true }, paste];
    }
  }
  if (target.kind === 'point' && target.id) {
    const ref = parsePoint(target.id);
    if (ref?.kind === 'key') {
      return keyEntries(ref.row, ref.index);
    }
    if (ref?.kind === 'calloutKey') {
      return [
        {
          id: 'delete',
          label: 'Delete place key',
          danger: true,
          onSelect: () => calloutsActions.deleteKeys(ref.callout, [ref.index]),
        },
      ];
    }
  }
  if (target.kind === 'item' && target.id) {
    const ref = parseItem(target.id);
    if (ref?.kind === 'step') {
      return [
        {
          id: 'play',
          label: 'Play this step',
          shortcut: 'animation.playStep',
          onSelect: () => playerActions.playStep(ref.id),
        },
        {
          id: 'pause',
          label: 'Pause at its end — on / off',
          shortcut: 'animation.step.pauseAtEnd',
          onSelect: () => stepsActions.togglePause(ref.id),
        },
        {
          id: 'delete',
          label: 'Delete step',
          danger: true,
          shortcut: 'animation.step.remove',
          onSelect: () => stepsActions.remove(ref.id),
        },
      ];
    }
    if (ref?.kind === 'callout') {
      return [
        {
          id: 'key',
          label: 'Key its place here',
          shortcut: 'animation.overlay.keyHere',
          onSelect: () => calloutsActions.keyHere(ref.id),
        },
        {
          id: 'delete',
          label: 'Delete overlay',
          danger: true,
          shortcut: 'animation.overlay.remove',
          onSelect: () => calloutsActions.remove(ref.id),
        },
      ];
    }
    if (ref?.kind === 'span') {
      return rowEntries(ref.row);
    }
  }
  return [
    paste,
    { id: 'step', label: 'Add a step here', shortcut: 'animation.addStep', onSelect: () => stepsActions.addAtSlider() },
  ];
}

// -----------------------------------------------------------------------------
// hook
// -----------------------------------------------------------------------------

/** The Timeline's right-click menu: a click in a lane takes the time slider
 *  there (not one on a row's name or a key), and the row's / key's / bar's
 *  actions are offered. */
export function useTimelineMenu(): {
  anchor: { x: number; y: number } | null;
  items: MenuEntry[];
  open: (target: Target, at: { x: number; y: number }) => void;
  close: () => void;
} {
  const [menu, setMenu] = useState<{ anchor: { x: number; y: number }; items: MenuEntry[] } | null>(null);
  return {
    anchor: menu?.anchor ?? null,
    items: menu?.items ?? [],
    open: (target, at) => {
      // its entries all edit: nothing to offer while playing back only
      if (!animationUiActions.isAuthoring()) {
        return;
      }
      if (target.kind !== 'point' && target.kind !== 'row') {
        playerActions.seek(target.t);
      }
      setMenu({ anchor: at, items: entriesFor(target) });
    },
    close: () => setMenu(null),
  };
}
