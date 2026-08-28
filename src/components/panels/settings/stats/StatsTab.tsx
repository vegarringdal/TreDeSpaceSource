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
      <Check
        label="Show overlay in viewport"
        tooltip="Draw the stats list in the viewport corner; turning it on also turns on GPU pass timing. Untick rows above to leave them out of the overlay"
        shortcut="stats.overlay"
        checked={v.showStats}
        onChange={(x) => act.update(x ? { showStats: true, gpuTimings: true } : { showStats: false })}
      />
      <Check
        label="Dimmed background behind overlay"
        tooltip="Paint a dark translucent box behind the overlay text so it stays readable over bright models"
        shortcut="stats.backdrop"
        checked={v.statsBackdrop}
        disabled={!v.showStats}
        onChange={(x) => act.update({ statsBackdrop: x })}
      />
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
