import { Collapsible } from '@treDeSpaceUI/widgets';
import { getRenderer, viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Check } from '../Check';
import { StatsReadout } from './StatsReadout';

/** Settings → Stats tab: live readout + overlay/timing toggles. */
export function StatsTab() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <Collapsible title="Stats">
      <StatsReadout />
      <Check label="Show overlay in viewport" checked={v.showStats} onChange={(x) => act.update({ showStats: x })} />
      <Check
        label="Measure GPU pass times (timestamp query)"
        checked={v.gpuTimings}
        shortcut="stats.gpuTimings"
        onChange={(x) => act.update({ gpuTimings: x })}
      />
      {v.gpuTimings && getRenderer() && !getRenderer()?.gpuTimingSupported && (
        <div className="text-amber-400 text-xs">
          timestamp-query is not supported by this adapter — GPU times unavailable.
        </div>
      )}
      <Check
        label="Verbose trace (phase timings → Console)"
        tooltip="Log per-phase performance timings for heavy operations (e.g. Set Color) to the Console — dev diagnostic"
        shortcut="stats.trace"
        checked={v.trace}
        onChange={(x) => act.update({ trace: x })}
      />
      <button type="button" className="btn mt-2 self-start" onClick={() => act.reset()}>
        Reset viewer defaults
      </button>
    </Collapsible>
  );
}
