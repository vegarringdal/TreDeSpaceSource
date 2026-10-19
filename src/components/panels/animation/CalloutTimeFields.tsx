import { Select, type SelectOption, TimeInput } from '@treDeSpaceUI/widgets';
import type { Callout } from '../../../lib/animation/types';
import type { OverlayFx } from '../../../lib/overlay/overlayTypes';
import { calloutsActions } from '../../../state/animation/callouts.actions';

const FX: readonly SelectOption<OverlayFx['kind']>[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'pop', label: 'Pop' },
  { value: 'slide', label: 'Slide' },
];
const FX_S = 0.3;

/** An effect of the chosen kind, keeping the duration it had. */
function fxOf(f: OverlayFx, kind: OverlayFx['kind']): OverlayFx {
  if (kind === 'none') {
    return { kind };
  }
  const duration = f.kind === 'none' ? FX_S : f.duration;
  return kind === 'slide' ? { kind, from: 'bottom', duration } : { kind, duration };
}

/** When a callout shows and hides, and its enter / exit effects. */
export function CalloutTimeFields({ callout }: { callout: Callout }) {
  const id = callout.id;
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-1">
        <TimeInput
          label="Show"
          tooltip="When the overlay appears (s on the scene clock)"
          labelPosition="left"
          labelWidth={40}
          value={callout.start}
          onChange={(t) => calloutsActions.setSpan(id, t, callout.end, `callout-span:${id}`)}
        />
        <TimeInput
          label="Hide"
          tooltip="When the overlay goes (s on the scene clock)"
          labelPosition="left"
          labelWidth={40}
          value={callout.end}
          onChange={(t) => calloutsActions.setSpan(id, callout.start, t, `callout-span:${id}`)}
        />
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Select
          tooltip="How the overlay appears"
          label="Enter"
          labelPosition="left"
          labelWidth={40}
          value={callout.enter.kind}
          options={FX}
          clearable={false}
          onChange={(k) => k && calloutsActions.update(id, { enter: fxOf(callout.enter, k) })}
        />
        <Select
          tooltip="How the overlay goes away"
          label="Exit"
          labelPosition="left"
          labelWidth={40}
          value={callout.exit.kind}
          options={FX}
          clearable={false}
          onChange={(k) => k && calloutsActions.update(id, { exit: fxOf(callout.exit, k) })}
        />
      </div>
    </div>
  );
}
