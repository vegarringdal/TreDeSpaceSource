import { IconBookmark } from '@tabler/icons-react';
import { RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { hostBookmarkActions } from '../../../state/animation/hostBookmark.actions';
import { hostBookmarkState } from '../../../state/animation/hostBookmark.state';

/** Bookmark: the hosting page's button (`animation.setBookmarkButton`) — a
 *  click sends it the animation as it is. Absent until the host sets it. */
export function AnimBookmarkGroups() {
  const button = hostBookmarkState.useSelect((s) => s.button);
  if (!button) {
    return null;
  }

  return (
    <RibbonSection title="Bookmark">
      <RibbonButton
        size="big"
        icon={<IconBookmark />}
        label={button.label}
        tooltip={button.tooltip || 'Send this animation to the hosting page as a bookmark'}
        shortcut="animation.bookmark"
        onClick={hostBookmarkActions.clicked}
      />
    </RibbonSection>
  );
}
