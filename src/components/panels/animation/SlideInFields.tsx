import { IconArrowBarToDown } from '@tabler/icons-react';
import { Button, Collapsible, NumberInput, Select } from '@treDeSpaceUI/widgets';
import { SLIDE_DIRECTIONS } from '../../../lib/animation/keyRows';
import type { AnimObject } from '../../../lib/animation/types';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { objectsActions } from '../../../state/animation/objects.actions';

const LABEL_W = 56;

/** Slide in from the time slider: from which side, how far (metres), how
 *  long. It waits hidden away from its place, appears at the time slider
 *  and slides into place. */
export function SlideInFields({ object }: { object: AnimObject }) {
  const s = animationUiState.useSelect((x) => x.slideIn);
  const set = (patch: Partial<typeof s>) => animationUiActions.set({ slideIn: { ...s, ...patch } });

  return (
    <Collapsible title="Slide in">
      <div className="flex flex-col gap-1">
        <Select
          tooltip="The side it comes from"
          shortcut="animation.slideIn.direction"
          label="From"
          labelPosition="left"
          labelWidth={LABEL_W}
          value={s.dir}
          options={SLIDE_DIRECTIONS.map((d) => ({ value: d.value, label: d.label }))}
          clearable={false}
          onChange={(dir) => dir && set({ dir })}
        />
        <NumberInput
          tooltip="How far away it starts (metres)"
          decShortcut="animation.slideIn.distance.dec"
          incShortcut="animation.slideIn.distance.inc"
          label="Distance"
          labelPosition="left"
          labelWidth={LABEL_W}
          value={s.distance}
          min={0}
          step={0.1}
          unit="m"
          onChange={(distance) => set({ distance })}
        />
        <NumberInput
          tooltip="Seconds it takes to slide into place"
          decShortcut="animation.slideIn.duration.dec"
          incShortcut="animation.slideIn.duration.inc"
          label="Takes"
          labelPosition="left"
          labelWidth={LABEL_W}
          value={s.duration}
          min={0.1}
          step={0.25}
          unit="s"
          onChange={(duration) => set({ duration })}
        />
        <Button
          size="sm"
          icon={<IconArrowBarToDown />}
          tooltip="Hidden away until the time slider, then it slides into place (keys in that time are replaced)"
          shortcut="animation.slideIn"
          onClick={() => objectsActions.slideInWithSettings(object.id)}
        >
          Slide in from the time slider
        </Button>
      </div>
    </Collapsible>
  );
}
