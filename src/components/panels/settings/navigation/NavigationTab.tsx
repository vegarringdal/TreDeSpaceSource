import { Collapsible, NumberInput, RadioGroup } from '@treDeSpaceUI/widgets';
import { navActions, navState } from '../../../../state/viewer/nav.state';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Check } from '../Check';
import { Row } from '../Row';
import { buildSpeedRows } from './navigationSpeedRows';

const NAV_MODES = [
  {
    value: 'orbit',
    label: 'Orbit',
    info: 'Look/pan around a pivot. Pressing the movement keys switches to fly/walk.',
    shortcut: 'nav.mode.orbit',
  },
  {
    value: 'fly',
    label: 'Fly',
    info: 'Free flight — move along the direction you are looking.',
    shortcut: 'nav.mode.fly',
  },
  {
    value: 'walk',
    label: 'Walk',
    info: 'Move at a constant height, like walking the model on foot.',
    shortcut: 'nav.mode.walk',
  },
];

/** Settings → Navigation tab: mode, speeds and sensitivities. */
export function NavigationTab() {
  const v = useViewer();
  const nav = navState.use();
  const speedRows = buildSpeedRows(nav);

  return (
    <Collapsible title="Navigation">
      <div className="text-slate-400 text-xs">Mode (TAB toggles)</div>
      <RadioGroup
        options={NAV_MODES}
        value={nav.mode}
        onChange={(x) => navActions.setMode(x as 'orbit' | 'fly' | 'walk')}
      />
      <Check
        label="Walk when movement keys are used"
        checked={nav.keysDefaultWalk}
        shortcut="nav.keysDefaultWalk"
        onChange={(x) => navActions.update({ keysDefaultWalk: x })}
      />
      {speedRows.map((r) => (
        <Row key={r.shortcutBase} label={r.label}>
          <NumberInput
            value={r.value}
            min={r.min}
            max={r.max}
            step={r.step}
            unit={r.unit}
            decShortcut={`${r.shortcutBase}.dec`}
            incShortcut={`${r.shortcutBase}.inc`}
            onChange={r.onChange}
          />
        </Row>
      ))}
      <Check
        label="Frame dense bounds on load"
        checked={v.fitDense}
        shortcut="nav.fitDense"
        onChange={(x) => viewerActions.update({ fitDense: x })}
        info={
          <>
            Fits "where 80% of the model is" (baked in at cook, v8 files) instead of the full bounding box — outliers
            far from the plant stop zooming the first view out.
          </>
        }
      />
    </Collapsible>
  );
}
