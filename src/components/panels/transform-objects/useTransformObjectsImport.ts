import { readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { type ReactNode, useEffect } from 'react';
import { transformActions as act } from '../../../state/transform/transform.actions';
import { dialogs } from '../../dialogs/dialogs.actions';
import { registerTransformObjectsLoad } from './transformObjectsPanel';

/** File-picker plumbing for the Transform Objects panel's Load… button:
 *  loads an objects file, reports the outcome in a dialog, and registers the
 *  picker so the transform.load hotkey works from outside the panel. */
export function useTransformObjectsImport(): { openPicker: () => void; pickerElement: ReactNode } {
  const picker = useFilePicker('application/json,.json', (f) =>
    readFileText(f, (text) => {
      const result = act.importJson(text);
      if (result.error) {
        dialogs.warn(`Load failed: ${result.error.msg}`);
        return;
      }

      dialogs.success(`Loaded ${result.data ?? 0} transform object(s).`);
    }),
  );

  useEffect(() => {
    registerTransformObjectsLoad(picker.open);
    return () => registerTransformObjectsLoad(null);
  }, [picker.open]);

  return { openPicker: picker.open, pickerElement: picker.element };
}
