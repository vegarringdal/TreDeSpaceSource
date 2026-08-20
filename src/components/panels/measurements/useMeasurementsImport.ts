import { readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { type ReactNode, useEffect } from 'react';
import { measurementsActions as act } from '../../../state/viewer/measurements.actions';
import { dialogs } from '../../dialogs/dialogs.actions';
import { registerMeasurementsLoad } from './measurementsPanel';

/** File-picker plumbing for the Measurements panel's Load… button: imports a
 *  measurements JSON file, reports the outcome in a dialog, and registers the
 *  picker so the measure.load hotkey works even from outside the panel. */
export function useMeasurementsImport(): { openPicker: () => void; pickerElement: ReactNode } {
  const picker = useFilePicker('application/json,.json', (f) =>
    readFileText(f, (text) => {
      try {
        const n = act.importJson(text);
        void dialogs.confirm(`Loaded ${n} measurement(s).`, { okLabel: 'OK' });
      } catch (e) {
        void dialogs.confirm(`Import failed: ${e instanceof Error ? e.message : String(e)}`, { okLabel: 'OK' });
      }
    }),
  );

  // let the measure.load hotkey pop the file picker even from outside the panel
  useEffect(() => {
    registerMeasurementsLoad(picker.open);
    return () => registerMeasurementsLoad(null);
  }, [picker.open]);

  return { openPicker: picker.open, pickerElement: picker.element };
}
