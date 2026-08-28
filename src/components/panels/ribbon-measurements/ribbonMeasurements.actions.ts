import { measurementsActions } from '../../../state/viewer/measurements.actions';
import type { MeasureLock } from '../../../state/viewer/measurements.state';
import { consoleActions } from '../console/console.actions';
import { openMeasurementsPanel } from '../measurements/measurementsPanel';
import { type RibbonMeasurementsState, ribbonMeasurementsState } from './ribbonMeasurements.state';

const log = (label: string) => consoleActions.log('info', `Measurements → ${label}`);

export const ribbonMeasurementsActions = {
  setTool(tool: RibbonMeasurementsState['tool']) {
    ribbonMeasurementsState.set({ tool });
    // 'off' clears the active measurement tool; anything else arms it.
    measurementsActions.setTool(tool === 'off' ? null : tool);
    log(`Tool → ${tool}`);
  },
  /** The "Off when ribbon switch" preference (default on). */
  setOffOnRibbonSwitch(on: boolean) {
    ribbonMeasurementsState.set({ offOnRibbonSwitch: on });
    log(`Off when ribbon switch → ${on ? 'on' : 'off'}`);
  },
  toggleOffOnRibbonSwitch() {
    ribbonMeasurementsActions.setOffOnRibbonSwitch(!ribbonMeasurementsState.get().offOnRibbonSwitch);
  },
  /** App startup feeds every active-ribbon change here: leaving the
   *  Measurements ribbon with a tool armed turns it off (when the preference
   *  is on). Arriving on it, or moving between other ribbons, does nothing. */
  ribbonChanged(prev: string | undefined, next: string | undefined) {
    if (prev === 'ribbonMeasurements' && next !== 'ribbonMeasurements') {
      ribbonMeasurementsActions.disarmForSwitch();
    }
  },
  /** A layout slot was activated (Layout ribbon / F-keys) — same rule. */
  layoutSwitched() {
    ribbonMeasurementsActions.disarmForSwitch();
  },
  disarmForSwitch() {
    const s = ribbonMeasurementsState.get();
    if (s.offOnRibbonSwitch && s.tool !== 'off') {
      ribbonMeasurementsActions.setTool('off');
    }
  },
  setLock(lock: MeasureLock) {
    measurementsActions.setLock(lock);
    log(`Lock → ${lock}`);
  },
  list: () => {
    openMeasurementsPanel();
    log('List');
  },
};
