import { Select } from '@treDeSpaceUI/widgets';
import type { Scene } from '../../../lib/animation/types';
import { scenesActions } from '../../../state/animation/scenes.actions';
import { overlayLibraryState } from '../../../state/overlayComponents/overlayComponents.state';
import { useOverlayThemeOptions } from '../shared/useOverlayThemeOptions';

const NONE = '__none';
const LABEL_W = 72;

/** The card every step shows unless it has its own (or none). */
export function SceneStepCardField({ scene }: { scene: Scene }) {
  const lib = overlayLibraryState.use();
  const themes = useOverlayThemeOptions();
  const card = scene.stepCard;

  return (
    <div className="flex flex-col gap-1">
      <Select
        tooltip="The card every step shows unless it has its own"
        shortcut="animation.stepCards"
        label="Step card"
        labelPosition="left"
        labelWidth={LABEL_W}
        value={card?.component ?? NONE}
        options={[{ value: NONE, label: 'None' }, ...lib.components.map((c) => ({ value: c.id, label: c.name }))]}
        clearable={false}
        onChange={(v) =>
          v && scenesActions.setStepCard(v === NONE ? null : { component: v, theme: card?.theme ?? null })
        }
      />
      {card && (
        <Select
          tooltip="The step card's colour theme — Auto follows the app's light / dark theme"
          label="Theme"
          labelPosition="left"
          labelWidth={LABEL_W}
          value={themes.toValue(card.theme)}
          options={themes.options}
          clearable={false}
          onChange={(v) => scenesActions.setStepCard({ component: card.component, theme: themes.fromValue(v) })}
        />
      )}
    </div>
  );
}
