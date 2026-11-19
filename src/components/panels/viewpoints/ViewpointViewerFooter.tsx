import { IconMapPinOff, IconRulerOff, IconUpload } from '@tabler/icons-react';
import { Button, readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { labelsActions } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { measurementsActions } from '../../../state/viewer/measurements.actions';
import { measurementsState } from '../../../state/viewer/measurements.state';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';

/** The Viewpoint Viewer's bottom row, fixed under the list: load a viewpoint
 *  file, and the quick mute toggles for labels / measurements. */
export function ViewpointViewerFooter() {
  const labelsMuted = labelsState.use().muted;
  const measureMuted = measurementsState.use().muted;
  const picker = useFilePicker('.json', (f) => readFileText(f, act.loadFromText));

  return (
    <div className="flex shrink-0 flex-wrap justify-center gap-1.5 border-slate-800 border-t pt-1.5">
      <Button
        icon={<IconUpload size={14} />}
        tooltip="Load viewpoints from a JSON file (replaces the current set)"
        shortcut="viewpoints.load"
        onClick={picker.open}
      >
        Load
      </Button>
      {picker.element}
      <Button
        active={labelsMuted}
        icon={<IconMapPinOff size={14} />}
        tooltip="Hide/show all labels in the viewport"
        shortcut="labels.muteAll"
        onClick={() => labelsActions.toggleMuted()}
      >
        {labelsMuted ? 'Labels off' : 'Mute labels'}
      </Button>
      <Button
        active={measureMuted}
        icon={<IconRulerOff size={14} />}
        tooltip="Hide/show all measurements in the viewport"
        shortcut="measure.muteAll"
        onClick={() => measurementsActions.toggleMuted()}
      >
        {measureMuted ? 'Measures off' : 'Mute measures'}
      </Button>
    </div>
  );
}
