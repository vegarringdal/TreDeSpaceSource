import { Ribbon } from '@treDeSpaceUI/widgets';
import { HomeAssetsGroups } from './HomeAssetsGroups';
import { HomeExternalGroup } from './HomeExternalGroup';
import { HomeResetGroups } from './HomeResetGroups';
import { HomeThemeGroup } from './HomeThemeGroup';
import { HomeViewGroups } from './HomeViewGroups';

/** Home ribbon: external apps promoted here, asset panel openers, canvas
 *  actions, view/camera toggles, the local-data reset actions and, last, the
 *  theme toggle. */
export function RibbonHome() {
  return (
    <Ribbon>
      <HomeExternalGroup at="start" />
      <HomeAssetsGroups />
      <HomeViewGroups />
      <HomeResetGroups />
      <HomeThemeGroup />
      <HomeExternalGroup at="end" />
    </Ribbon>
  );
}
