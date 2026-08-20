import { Ribbon } from '@treDeSpaceUI/widgets';
import { PadNavGroups } from './PadNavGroups';
import { PadViewGroups } from './PadViewGroups';

/** Pad — big-target controls for tablet use: view helpers, tree navigation,
 *  camera mode and the on-screen move joystick. */
export function RibbonPad() {
  return (
    <Ribbon>
      <PadViewGroups />
      <PadNavGroups />
    </Ribbon>
  );
}
