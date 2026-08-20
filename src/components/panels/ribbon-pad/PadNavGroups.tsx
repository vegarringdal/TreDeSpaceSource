import { IconDeviceGamepad2, IconRotate3d, IconRotate360, IconWalk } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { navActions, navState } from '../../../state/viewer/nav.state';
import { useViewer, viewerState } from '../../../state/viewer/viewer.state';
import { PadPosInput } from './PadPosInput';

/** Camera navigation mode and the on-screen joystick controls. */
export function PadNavGroups() {
  const nav = navState.use();
  const v = useViewer();

  return (
    <>
      <RibbonSection title="Nav">
        <RibbonButton
          icon={<IconRotate3d />}
          label="Orbit"
          selected={nav.mode === 'orbit'}
          tooltip="Orbit only — look and pan, movement keys off"
          shortcut="nav.mode.orbit"
          onClick={() => navActions.setMode('orbit')}
        />
        <RibbonButton
          icon={<IconRotate360 />}
          label="Fly"
          selected={nav.mode === 'fly'}
          tooltip="Fly — move along the view direction"
          shortcut="nav.mode.fly"
          onClick={() => navActions.setMode('fly')}
        />
        <RibbonButton
          icon={<IconWalk />}
          label="Walk"
          selected={nav.mode === 'walk'}
          tooltip="Walk — stay at a constant height"
          shortcut="nav.mode.walk"
          onClick={() => navActions.setMode('walk')}
        />
      </RibbonSection>

      <RibbonSection title="Controller">
        <RibbonButton
          icon={<IconDeviceGamepad2 />}
          label="Joystick"
          selected={v.touchPads}
          tooltip="On-screen joysticks: left = move, right = look/direction (two fingers still pan)"
          shortcut="view.touchPads"
          onClick={() => viewerState.set((s) => ({ touchPads: !s.touchPads }))}
        />
        <PadPosInput
          label="Position from top"
          value={v.joystickY}
          decShortcut="view.joystick.y.dec"
          incShortcut="view.joystick.y.inc"
          onChange={(y) => viewerState.set({ joystickY: y })}
        />
        <PadPosInput
          label="Position from sides"
          value={v.joystickX}
          decShortcut="view.joystick.x.dec"
          incShortcut="view.joystick.x.inc"
          onChange={(x) => viewerState.set({ joystickX: x })}
        />
      </RibbonSection>
    </>
  );
}
