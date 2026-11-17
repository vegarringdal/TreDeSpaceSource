import { Ribbon } from '@treDeSpaceUI/widgets';
import { MeasureSnapGroups } from './MeasureSnapGroups';
import { MeasureToolGroups } from './MeasureToolGroups';

/** Measurements ribbon: tool selection, placement locks, snapping options and
 *  the measurement list. */
export function RibbonMeasurements() {
  return (
    <Ribbon>
      <MeasureToolGroups />
      <MeasureSnapGroups />
    </Ribbon>
  );
}
