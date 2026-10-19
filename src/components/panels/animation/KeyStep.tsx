import { IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import { Button, Checkbox, TextArea, TextInput, TimeInput } from '@treDeSpaceUI/widgets';
import type { Scene, Step } from '../../../lib/animation/types';
import { playerActions } from '../../../state/animation/player.actions';
import { stepsActions } from '../../../state/animation/steps.actions';
import { InspectorFrame } from './InspectorFrame';
import { StepCardFields } from './StepCardFields';

const LABEL_W = 56;

/** A step: its name and text (its card shows them), when it runs, whether
 *  playback waits at its end, its card and presenter notes. */
export function KeyStep({ scene, step }: { scene: Scene; step: Step }) {
  const actions = (
    <>
      <Button
        iconOnly
        size="sm"
        variant="ghost"
        icon={<IconPlayerPlay />}
        tooltip="Play this step"
        shortcut="animation.playStep"
        onClick={() => playerActions.playStep(step.id)}
      />
      <Button
        iconOnly
        size="sm"
        variant="ghost"
        icon={<IconTrash />}
        tooltip="Delete this step (the objects' keys stay)"
        shortcut="animation.step.remove"
        onClick={() => stepsActions.remove(step.id)}
      />
    </>
  );

  return (
    <InspectorFrame kind="Step" name={step.name || 'Step'} actions={actions}>
      <TextInput
        tooltip="The step's name — its card shows it ({{step.name}})"
        label="Name"
        labelPosition="left"
        labelWidth={LABEL_W}
        value={step.name}
        onChange={(name) => stepsActions.update(step.id, { name }, `step-name:${step.id}`)}
      />
      <TextArea
        tooltip="The step's text ({{step.text}}): **bold**, line breaks"
        label="Text (**bold**)"
        rows={3}
        value={step.text}
        onChange={(text) => stepsActions.update(step.id, { text }, `step-text:${step.id}`)}
      />
      <div className="grid grid-cols-2 gap-1">
        <TimeInput
          label="Start"
          tooltip="When the step starts (s)"
          labelPosition="left"
          labelWidth={36}
          value={step.start}
          onChange={(t) => stepsActions.setSpan(step.id, t, step.end, `step-span:${step.id}`)}
        />
        <TimeInput
          label="End"
          tooltip="When the step ends (s) — playback can wait here"
          labelPosition="left"
          labelWidth={36}
          value={step.end}
          onChange={(t) => stepsActions.setSpan(step.id, step.start, t, `step-span:${step.id}`)}
        />
      </div>
      <Checkbox
        tooltip="Playback waits at the end of this step until Continue"
        shortcut="animation.step.pauseAtEnd"
        label="Pause at the end"
        checked={step.pauseAtEnd}
        onChange={() => stepsActions.togglePause(step.id)}
      />
      <StepCardFields scene={scene} step={step} />
      <TextArea
        tooltip="Notes for the presenter — not in the picture"
        label="Notes"
        rows={2}
        value={step.notes ?? ''}
        onChange={(notes) => stepsActions.update(step.id, { notes: notes || undefined }, `step-notes:${step.id}`)}
      />
    </InspectorFrame>
  );
}
