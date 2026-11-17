import { IconMessage2Plus } from '@tabler/icons-react';
import { Button, Menu } from '@treDeSpaceUI/widgets';
import { useAddOverlayEntries } from '../animation/useAddOverlayEntries';
import { useMenuAnchor } from '../shared/useMenuAnchor';

/** Overlay ▾: a callout on the selection, a title, caption, info card, step
 *  card or one of the user's designs on the Overlays row, from the time
 *  slider. */
export function TimelineOverlayMenu() {
  const menu = useMenuAnchor('animation.menu.overlay');
  const entries = useAddOverlayEntries();

  return (
    <>
      <span ref={menu.wrap} className="inline-flex">
        <Button
          size="sm"
          icon={<IconMessage2Plus />}
          tooltip="A callout on the selection, a title, a caption, an info card… on the Overlays row, from the time slider"
          shortcut="animation.menu.overlay"
          onClick={menu.open}
        >
          Overlay ▾
        </Button>
      </span>
      <Menu anchor={menu.anchor} onClose={menu.close} minWidth={220} items={entries} />
    </>
  );
}
