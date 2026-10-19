import { IconFlag } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import type { Scene } from '../../../lib/animation/types';
import { stepsActions } from '../../../state/animation/steps.actions';
import { InspectorFrame } from './InspectorFrame';
import { SceneStepCardField } from './SceneStepCardField';

/** The Steps row picked, no step: add one, the scene's step card. */
export function KeyStepsRow({ scene }: { scene: Scene }) {
  const n = scene.steps.length;
  return (
    <InspectorFrame kind="Steps" name={`${n} step${n === 1 ? '' : 's'}`}>
      <Button
        size="sm"
        variant="primary"
        icon={<IconFlag />}
        tooltip="A step from the time slider to the next step (or 5 s) (I)"
        shortcut="animation.addStep"
        onClick={() => stepsActions.addAtSlider()}
      >
        Add a step here
      </Button>
      <span className="text-[11px] text-slate-400">
        A step is a named span: its card shows while it runs, and playback can wait at its end. Steps do not move
        anything — key the objects in the same time.
      </span>
      <SceneStepCardField scene={scene} />
    </InspectorFrame>
  );
}
