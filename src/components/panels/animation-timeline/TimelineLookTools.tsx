import { IconColorFilter, IconEye, IconEyeOff, IconPalette } from '@tabler/icons-react';
import { Button, ColorSelect, SplitButton } from '@treDeSpaceUI/widgets';
import { instantAt } from '../../../lib/animation/keyRows';
import type { Scene } from '../../../lib/animation/types';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { keysActions } from '../../../state/animation/keys.actions';
import { playerState } from '../../../state/animation/player.state';
import { QUICK_TRANSPARENT } from '../../../state/animation/quickRules.actions';
import { rowObject } from '../../../state/animation/rows';
import { rulesMenuItems } from './rulesMenu';

/** Show / hide, colour and transparency of the current object from the time
 *  slider on, the key colour, and colour rules (the Key panel's, or quick ones
 *  for the selection or the whole model). */
export function TimelineLookTools({ scene }: { scene: Scene }) {
  const ui = animationUiState.use();
  const time = playerState.useSelect((s) => s.time);
  const id = rowObject(ui.current);
  const object = id ? scene.objects.find((o) => o.id === id) : undefined;
  const shown = object ? (instantAt(object, time).visible ?? true) : true;
  const ids = id ? [id] : [];

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        iconOnly
        size="sm"
        icon={shown ? <IconEye /> : <IconEyeOff />}
        disabled={!object}
        tooltip={
          shown ? 'Hide the current object from the time slider on' : 'Show the current object from the time slider on'
        }
        shortcut="animation.visible.toggle"
        onClick={() => id && keysActions.toggleVisibleFromHere(id)}
      />
      <ColorSelect
        compact
        value={ui.keyColor}
        tooltip="The colour Colour from here (and Colour the selection) keys"
        onChange={(keyColor) => animationUiActions.set({ keyColor })}
      />
      <SplitButton
        size="sm"
        icon={<IconPalette />}
        label="Colour"
        disabled={!object}
        tooltip="The current object in the key colour from the time slider on"
        shortcut="animation.colorFromHere"
        menuTooltip="Own colour, transparency, hide or show from the time slider on"
        onClick={() => keysActions.instantFromHere(ids, { color: ui.keyColor })}
        menu={[
          {
            id: 'own',
            label: 'Own colour from here',
            shortcut: 'animation.ownColorFromHere',
            onSelect: () => keysActions.instantFromHere(ids, { color: null }),
          },
          {
            id: 'transparent',
            label: `Transparent from here (${Math.round(QUICK_TRANSPARENT * 100)} % opacity)`,
            shortcut: 'animation.transparentFromHere',
            onSelect: () => keysActions.instantFromHere(ids, { opacity: QUICK_TRANSPARENT }),
          },
          {
            id: 'opaque',
            label: 'Opaque from here',
            shortcut: 'animation.opaqueFromHere',
            onSelect: () => keysActions.instantFromHere(ids, { opacity: 1 }),
          },
          { separator: true },
          {
            id: 'hide',
            label: 'Hide from here',
            shortcut: 'animation.hideFromHere',
            onSelect: () => keysActions.instantFromHere(ids, { visible: false }),
          },
          {
            id: 'show',
            label: 'Show from here',
            shortcut: 'animation.showFromHere',
            onSelect: () => keysActions.instantFromHere(ids, { visible: true }),
          },
        ]}
      />
      <SplitButton
        size="sm"
        icon={<IconColorFilter />}
        label="Rules"
        tooltip="Key the colour rules built in the Key panel, from the time slider on"
        shortcut="animation.rulesKey"
        menuTooltip="Quick rules for the selection or the whole model; edit the rules in force"
        onClick={() => keysActions.keyRules()}
        menu={rulesMenuItems()}
      />
    </div>
  );
}
