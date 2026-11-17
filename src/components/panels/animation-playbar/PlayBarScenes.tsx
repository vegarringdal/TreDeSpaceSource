import { IconMovie } from '@tabler/icons-react';
import { Button, Menu } from '@treDeSpaceUI/widgets';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { playerActions } from '../../../state/animation/player.actions';
import { useMenuAnchor } from '../shared/useMenuAnchor';

/** The scene to present, when the animation has more than one. */
export function PlayBarScenes({ size }: { size: 'md' | 'lg' }) {
  const s = animationDocState.use();
  // its hotkey only while the button shows (more than one scene)
  const menu = useMenuAnchor(s.doc.scenes.length > 1 ? 'animation.menu.playBarScene' : undefined);
  if (s.doc.scenes.length < 2) {
    return null;
  }
  const scene = s.doc.scenes.find((x) => x.id === s.activeScene) ?? s.doc.scenes[0];

  return (
    <>
      <span ref={menu.wrap} className="inline-flex">
        <Button
          size={size}
          variant="ghost"
          icon={<IconMovie />}
          tooltip="The scene that plays — pick another (it starts from its beginning)"
          shortcut="animation.menu.playBarScene"
          onClick={menu.open}
        >
          <span className="max-w-40 truncate">{scene?.name || 'Scene'}</span> ▾
        </Button>
      </span>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={s.doc.scenes.map((x) => ({
          id: `scene:${x.id}`,
          label: `${x.id === scene?.id ? '✓ ' : ''}${x.name || 'Scene'}`,
          onSelect: () => playerActions.switchScene(x.id),
        }))}
      />
    </>
  );
}
