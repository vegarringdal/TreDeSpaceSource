import { IconEye, IconEyeOff, IconTrash } from '@tabler/icons-react';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import { measurementsActions as act } from '../../../state/viewer/measurements.actions';
import { measurementsState } from '../../../state/viewer/measurements.state';

/** Load & save: write every measurement to a JSON file, load a set back,
 *  mute them all in the viewport, or delete them all. */
export function MeasurementsFilesSection({
  openPicker,
  pickerElement,
}: {
  openPicker: () => void;
  pickerElement: ReactNode;
}) {
  const { items, muted } = measurementsState.use();

  return (
    <Collapsible
      title="Load & save"
      info="Save every measurement to a JSON file, or load a set back from one. Handy for sharing a marked-up model or keeping measurements between sessions."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={items.length === 0}
          onClick={() => act.downloadJson()}
          tooltip="Save all measurements to a JSON file"
          shortcut="measure.save"
        >
          Save…
        </Button>
        <Button onClick={openPicker} tooltip="Load measurements from a JSON file" shortcut="measure.load">
          Load…
        </Button>
        <Button
          icon={muted ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          active={muted}
          onClick={() => act.toggleMuted()}
          tooltip="Hide/show all measurements in the viewport"
          shortcut="measure.muteAll"
        >
          {muted ? 'Show all' : 'Mute all'}
        </Button>
        <Button
          icon={<IconTrash size={14} />}
          disabled={items.length === 0}
          onClick={() => act.clear()}
          tooltip="Delete every measurement"
          shortcut="measure.clearAll"
        >
          Delete all
        </Button>
        {pickerElement}
      </div>
    </Collapsible>
  );
}
