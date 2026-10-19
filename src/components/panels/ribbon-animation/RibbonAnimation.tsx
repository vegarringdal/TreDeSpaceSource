import { Ribbon } from '@treDeSpaceUI/widgets';
import { AnimBookmarkGroups } from './AnimBookmarkGroups';
import { AnimEditGroups } from './AnimEditGroups';
import { AnimExportGroups } from './AnimExportGroups';
import { AnimModeGroups } from './AnimModeGroups';
import { AnimPanelsGroups } from './AnimPanelsGroups';
import { AnimViewGroups } from './AnimViewGroups';

/** Animation ribbon (DESIGN.md › Animation): Animate on / off with New /
 *  Open / Save, Export (video, step stills, Claude), the animation panels,
 *  the view toggles, undo / redo and — when the hosting page set one — its
 *  Bookmark button. Everything else is in the Timeline (objects, keys, play)
 *  and the Key panel. */
export function RibbonAnimation() {
  return (
    <Ribbon>
      <AnimModeGroups />
      <AnimExportGroups />
      <AnimPanelsGroups />
      <AnimViewGroups />
      <AnimEditGroups />
      <AnimBookmarkGroups />
    </Ribbon>
  );
}
