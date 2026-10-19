import { IconMessage2Plus } from '@tabler/icons-react';
import { Button, Menu } from '@treDeSpaceUI/widgets';
import type { Scene } from '../../../lib/animation/types';
import { useMenuAnchor } from '../shared/useMenuAnchor';
import { InspectorFrame } from './InspectorFrame';
import { useAddOverlayEntries } from './useAddOverlayEntries';

/** The Overlays row picked, no overlay: add one. */
export function KeyCalloutsRow({ scene }: { scene: Scene }) {
  const entries = useAddOverlayEntries();
  const menu = useMenuAnchor('animation.menu.overlayKey');
  const n = scene.callouts.length;

  return (
    <InspectorFrame kind="Overlays" name={`${n} overlay${n === 1 ? '' : 's'}`}>
      <span ref={menu.wrap} className="inline-flex self-start">
        <Button
          size="sm"
          icon={<IconMessage2Plus />}
          tooltip="A callout on the selected object, or a title, caption or info card on screen, from the time slider"
          shortcut="animation.menu.overlayKey"
          onClick={menu.open}
        >
          Add an overlay ▾
        </Button>
      </span>
      <span className="text-[11px] text-slate-400">
        An overlay shows for a while — a callout hanging from an object, or a title, caption or info card on screen.
        Drag it in the view to place it; Key here keys its place over time.
      </span>
      <Menu anchor={menu.anchor} items={entries} onClose={menu.close} />
    </InspectorFrame>
  );
}
