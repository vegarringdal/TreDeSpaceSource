import { NumberInput, RadioGroup, type RadioOption } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer, type ViewerState } from '../../../../state/viewer/viewer.state';
import { SettingsSection } from '../SettingsSection';

/** The radio values are strings; this maps each back to the state's numeric
 *  union, so the handler needs no assertion. */
const AO_MODES: Record<string, ViewerState['aoMode']> = { '0': 0, '1': 1, '2': 2 };

const aoModes: readonly RadioOption[] = [
  { value: '0', label: 'Off', shortcut: 'render.aoMode.off' },
  { value: '1', label: 'Motion', hint: 'every frame', shortcut: 'render.aoMode.motion' },
  { value: '2', label: 'Static', hint: 'accumulate at rest', shortcut: 'render.aoMode.static' },
];

/** Settings → Ambient Occlusion tab (VBAO mode + quality knobs). */
export function AoTab() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <SettingsSection
      id="ao"
      title="Ambient Occlusion"
      info={
        <>
          Ambient occlusion darkens the creases, corners and contact points where surfaces block ambient light from
          reaching each other — the soft shading that makes geometry read as solid rather than flat. This is a real-time
          screen-space approximation (VBAO).
          <br />
          <br />
          <b>Off</b> disables it. <b>Motion</b> recomputes every frame (costs GPU time as you move). <b>Static</b>{' '}
          accumulates a cleaner result while the camera is at rest. <b>Radius</b> is how far a surface casts occlusion;{' '}
          <b>Strength</b> the darkening amount; <b>Slices</b>/<b>Samples</b> trade quality for cost.
        </>
      }
    >
      <div className="text-slate-400 text-xs">Mode</div>
      <RadioGroup
        options={aoModes}
        value={String(v.aoMode)}
        onChange={(x) => act.update({ aoMode: AO_MODES[x] ?? 0 })}
      />
      <NumberInput
        label="Radius"
        labelPosition="split"
        value={v.aoRadius}
        min={0.05}
        max={10}
        step={0.1}
        unit="m"
        decShortcut="render.aoRadius.dec"
        incShortcut="render.aoRadius.inc"
        onChange={(x) => act.update({ aoRadius: x })}
      />
      <NumberInput
        label="Strength"
        labelPosition="split"
        value={v.aoStrength}
        min={0}
        max={1}
        step={0.05}
        decShortcut="render.aoStrength.dec"
        incShortcut="render.aoStrength.inc"
        onChange={(x) => act.update({ aoStrength: x })}
      />
      <NumberInput
        label="Slices"
        labelPosition="split"
        value={v.aoSlices}
        min={1}
        max={16}
        step={1}
        decShortcut="render.aoSlices.dec"
        incShortcut="render.aoSlices.inc"
        onChange={(x) => act.update({ aoSlices: x })}
      />
      <NumberInput
        label="Samples"
        labelPosition="split"
        value={v.aoSamples}
        min={1}
        max={12}
        step={1}
        decShortcut="render.aoSamples.dec"
        incShortcut="render.aoSamples.inc"
        onChange={(x) => act.update({ aoSamples: x })}
      />
    </SettingsSection>
  );
}
