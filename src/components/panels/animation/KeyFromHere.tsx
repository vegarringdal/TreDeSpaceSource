import { IconEye, IconEyeOff, IconPalette, IconPaletteOff } from '@tabler/icons-react';
import { Button, ColorSelect } from '@treDeSpaceUI/widgets';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { keysActions } from '../../../state/animation/keys.actions';

/** Instant keys at the time slider: hide, show or colour the objects from
 *  here on. */
export function KeyFromHere({ objects }: { objects: readonly string[] }) {
  const color = animationUiState.useSelect((s) => s.keyColor);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-slate-400">From the time slider on</span>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          icon={<IconEyeOff />}
          tooltip="Hidden from here (a key at the time slider)"
          shortcut="animation.hideFromHere"
          onClick={() => keysActions.instantFromHere(objects, { visible: false })}
        >
          Hide
        </Button>
        <Button
          size="sm"
          icon={<IconEye />}
          tooltip="Shown from here (a key at the time slider)"
          shortcut="animation.showFromHere"
          onClick={() => keysActions.instantFromHere(objects, { visible: true })}
        >
          Show
        </Button>
        <Button
          size="sm"
          icon={<IconPalette />}
          tooltip="This colour from here (a key at the time slider)"
          shortcut="animation.colorFromHere"
          onClick={() => keysActions.instantFromHere(objects, { color })}
        >
          Colour
        </Button>
        <Button
          size="sm"
          icon={<IconPaletteOff />}
          tooltip="Its own colour again from here"
          shortcut="animation.ownColorFromHere"
          onClick={() => keysActions.instantFromHere(objects, { color: null })}
        >
          Own colour
        </Button>
      </div>
      <ColorSelect
        label="Colour"
        labelPosition="split"
        tooltip="The colour Colour keys"
        value={color}
        onChange={(keyColor) => animationUiActions.set({ keyColor })}
      />
    </div>
  );
}
