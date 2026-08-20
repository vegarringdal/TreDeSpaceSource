import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconDownload,
  IconUpload,
} from '@tabler/icons-react';
import { Button, readFileText, Select, useFilePicker } from '@treDeSpaceUI/widgets';
import { useEffect } from 'react';
import { labelsActions as act } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { dialogs } from '../../dialogs/dialogs.actions';
import { registerLabelsLoad } from './labelsPanel';

/** Labels → Common, rows 3-4: explode/implode with layout shape, JSON
 *  save/load (owns the file picker + the labels.load hotkey hook-up), undo/redo. */
export function LabelsFileRows() {
  const s = labelsState.use();
  const picker = useFilePicker('application/json,.json', (f) =>
    readFileText(f, (text) => {
      try {
        const n = act.importJson(text);
        void dialogs.confirm(`Loaded ${n} label(s).`, { okLabel: 'OK' });
      } catch (e) {
        void dialogs.confirm(`Import failed: ${e instanceof Error ? e.message : String(e)}`, { okLabel: 'OK' });
      }
    }),
  );

  // let the labels.load hotkey pop the file picker even from outside the panel
  useEffect(() => {
    registerLabelsLoad(picker.open);
    return () => registerLabelsLoad(null);
  }, [picker.open]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          icon={<IconArrowsMaximize size={14} />}
          disabled={s.items.length === 0}
          tooltip="Fan the labels outward from the cluster center (press again to push further)"
          shortcut="labels.explode"
          onClick={act.explode}
        >
          Explode
        </Button>
        <Button
          icon={<IconArrowsMinimize size={14} />}
          disabled={s.items.every((l) => l.offset[0] === 0 && l.offset[1] === 0)}
          tooltip="Move every label back onto its anchor point (undoes explode and manual drags)"
          shortcut="labels.implode"
          onClick={act.implode}
        >
          Implode
        </Button>
        <div data-tooltip="Explode layout shape" className="w-24">
          <Select
            options={[
              { value: 'circle', label: 'Circle' },
              { value: 'box', label: 'Box' },
            ]}
            value={s.explodeShape}
            onChange={(v) => act.setExplodeShape(v as 'circle' | 'box')}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          icon={<IconDownload size={14} />}
          disabled={s.items.length === 0}
          tooltip="Save all labels to a JSON file"
          shortcut="labels.save"
          onClick={act.downloadJson}
        >
          Save…
        </Button>
        <Button
          icon={<IconUpload size={14} />}
          tooltip="Load labels from a JSON file (replaces the current labels)"
          shortcut="labels.load"
          onClick={picker.open}
        >
          Load…
        </Button>
        <Button
          icon={<IconArrowBackUp size={14} />}
          disabled={s.undoDepth === 0}
          tooltip="Undo the last label change"
          shortcut="labels.undo"
          onClick={act.undo}
        >
          Undo
        </Button>
        <Button
          icon={<IconArrowForwardUp size={14} />}
          disabled={s.redoDepth === 0}
          tooltip="Redo the last undone label change"
          shortcut="labels.redo"
          onClick={act.redo}
        >
          Redo
        </Button>
        {picker.element}
      </div>
    </>
  );
}
