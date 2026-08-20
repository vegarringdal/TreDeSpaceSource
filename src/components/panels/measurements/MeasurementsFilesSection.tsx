import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import { measurementsActions as act } from '../../../state/viewer/measurements.actions';
import { measurementsState } from '../../../state/viewer/measurements.state';

/** Load & save: write every measurement to a JSON file, or load a set back. */
export function MeasurementsFilesSection({
  openPicker,
  pickerElement,
}: {
  openPicker: () => void;
  pickerElement: ReactNode;
}) {
  const { items } = measurementsState.use();

  return (
    <Collapsible
      title="Load & save"
      defaultOpen={false}
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
        {pickerElement}
      </div>
    </Collapsible>
  );
}
