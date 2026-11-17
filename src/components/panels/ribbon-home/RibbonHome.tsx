import { Ribbon } from '@treDeSpaceUI/widgets';
import { HomeAssetsGroups } from './HomeAssetsGroups';
import { HomeExternalGroup } from './HomeExternalGroup';
import { HomeResetGroups } from './HomeResetGroups';
import { HomeViewGroups } from './HomeViewGroups';

/** Home ribbon: external apps promoted here, the asset panel openers (+ wipe),
 *  the canvas actions (+ camera mode and theme), the sketch toggles and the
 *  quick-clear actions. */
export function RibbonHome() {
  return (
    <Ribbon>
      <HomeExternalGroup at="start" />
      <HomeAssetsGroups />
      <HomeViewGroups />
      <HomeResetGroups />
      <HomeExternalGroup at="end" />
    </Ribbon>
  );
}
