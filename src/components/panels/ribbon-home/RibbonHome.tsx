import { Ribbon } from '@treDeSpaceUI/widgets';
import { HomeAssetsGroups } from './HomeAssetsGroups';
import { HomeResetGroup } from './HomeResetGroup';
import { HomeViewGroups } from './HomeViewGroups';

/** Home ribbon: asset panel openers, canvas actions, view/camera toggles and
 *  the local-data reset actions. */
export function RibbonHome() {
  return (
    <Ribbon>
      <HomeAssetsGroups />
      <HomeViewGroups />
      <HomeResetGroup />
    </Ribbon>
  );
}
