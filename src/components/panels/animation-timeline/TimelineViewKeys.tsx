import { IconBox, IconCamera } from '@tabler/icons-react';
import { Button, type MenuEntry, SplitButton } from '@treDeSpaceUI/widgets';
import { keysActions } from '../../../state/animation/keys.actions';
import { playerActions } from '../../../state/animation/player.actions';
import { playerState } from '../../../state/animation/player.state';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';

/** Camera and clipping keys in one click, whatever row is current: the view
 *  now (or a saved viewpoint, an orbit) and the clipping now. */
export function TimelineViewKeys() {
  const viewpoints = viewpointsState.useSelect((s) => s.list);
  const free = playerState.useSelect((s) => s.camera === 'free' && s.canFollow);

  const menu: MenuEntry[] = [
    ...viewpoints.map((v) => ({
      id: `vp:${v.id}`,
      label: `Viewpoint “${v.name || 'Viewpoint'}” here`,
      tooltip: "A saved viewpoint's camera as a camera key at the time slider",
      onSelect: () => keysActions.keyViewpoint(v.id),
    })),
    viewpoints.length > 0 && { separator: true },
    {
      id: 'orbit',
      label: 'Orbit from here',
      tooltip: 'One turn around what the view looks at (8 s of camera keys)',
      shortcut: 'animation.preset.orbit',
      onSelect: keysActions.cameraOrbit,
    },
    {
      id: 'return',
      label: 'Back to the camera keys',
      disabled: !free,
      shortcut: 'animation.returnCamera',
      onSelect: playerActions.returnCamera,
    },
  ];

  return (
    <div className="flex items-center gap-1">
      <SplitButton
        size="sm"
        icon={<IconCamera />}
        label="Camera"
        tooltip="Camera key: the view now, at the time slider"
        shortcut="animation.cameraKey"
        menuTooltip="Key a saved viewpoint, orbit, back to the camera keys"
        onClick={() => keysActions.keyCamera()}
        menu={menu}
      />
      <Button
        size="sm"
        icon={<IconBox />}
        tooltip="Clipping key: the clipping now (box, planes, shapes), at the time slider"
        shortcut="animation.sectionKey"
        onClick={() => keysActions.keySection()}
      >
        Clipping
      </Button>
    </div>
  );
}
