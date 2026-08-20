import { Collapsible } from '@treDeSpaceUI/widgets';
import { MAX_LABELS } from '../../../state/viewer/labels.state';
import { LabelsFileRows } from './LabelsFileRows';
import { LabelsPlacementRows } from './LabelsPlacementRows';

/** Labels → Common: place, mute, select, delete, explode/implode, save/load, undo. */
export function LabelsCommonSection() {
  return (
    <Collapsible
      title="Common"
      info={
        <>
          Click <b>New label</b>, then click in the model. Drag a label to move it (a leader line points back);
          ctrl+click a label to select it. These rows place, mute, undo/redo, select, delete and explode/implode labels.
          Max {MAX_LABELS} labels.
        </>
      }
    >
      <LabelsPlacementRows />
      <LabelsFileRows />
    </Collapsible>
  );
}
