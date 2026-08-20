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
  setLock(lock: MeasureLock) {
    measurementsActions.setLock(lock);
    log(`Lock → ${lock}`);
  },
  list: () => {
    openMeasurementsPanel();
    log('List');
  },
};
