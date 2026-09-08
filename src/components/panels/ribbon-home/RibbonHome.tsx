import { Ribbon } from '@treDeSpaceUI/widgets';
import { HomeAssetsGroups } from './HomeAssetsGroups';
import { HomeExternalGroup } from './HomeExternalGroup';
import { HomeResetGroups } from './HomeResetGroups';
import { HomeViewGroups } from './HomeViewGroups';

/** Home ribbon: external apps promoted here, asset panel openers, canvas
 *  actions, view/camera toggles and the local-data reset actions. */
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
