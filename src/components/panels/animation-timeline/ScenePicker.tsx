import { IconMovie } from '@tabler/icons-react';
import { Button, Menu } from '@treDeSpaceUI/widgets';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { playerActions } from '../../../state/animation/player.actions';
import { scenesActions } from '../../../state/animation/scenes.actions';
import { useMenuAnchor } from '../shared/useMenuAnchor';

/** Scene ▾: the scene's name; switch scenes, rename, add or delete one. */
export function ScenePicker() {
  const s = animationDocState.use();
  const menu = useMenuAnchor('animation.menu.scene');
  const scene = s.doc.scenes.find((x) => x.id === s.activeScene) ?? s.doc.scenes[0];

  return (
    <>
      <span ref={menu.wrap} className="inline-flex">
        <Button
          size="sm"
          icon={<IconMovie />}
          tooltip="The scene you work on — switch, rename, add or delete one"
          shortcut="animation.menu.scene"
          onClick={menu.open}
        >
          <span className="max-w-28 truncate">{scene?.name || 'Scene'}</span> ▾
        </Button>
      </span>
      <Menu
        anchor={menu.anchor}
        onClose={menu.close}
        items={[
          ...s.doc.scenes.map((x) => ({
            id: `scene:${x.id}`,
            label: `${x.id === scene?.id ? '✓ ' : ''}${x.name || 'Scene'}`,
            tooltip: 'Work on / play this scene',
            onSelect: () => playerActions.switchScene(x.id),
          })),
          { separator: true },
          {
            id: 'rename',
            label: 'Rename this scene…',
            shortcut: 'animation.scene.rename',
            onSelect: () => void scenesActions.renamePrompt(),
          },
          {
            id: 'new',
            label: 'New scene…',
            shortcut: 'animation.scene.new',
            onSelect: () => void scenesActions.newSceneNamed(),
          },
          {
            id: 'delete',
            label: 'Delete this scene',
            danger: true,
            disabled: s.doc.scenes.length < 2,
            shortcut: 'animation.scene.delete',
            onSelect: scenesActions.deleteScene,
          },
        ]}
      />
    </>
  );
}
