import { IconDownload, IconEraser, IconTrash, IconUpload } from '@tabler/icons-react';
import { Button, readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { useContext } from 'react';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { MultiColorCtx } from './multiColorContext';

/** Set Color's footer: Save / Load / Delete all, Reset all — at the bottom
 *  like the Settings panel's, out of the way of the rules. Wraps onto a
 *  second line in a narrow panel. */
export function RuleSetActions() {
  const { store, act } = useContext(MultiColorCtx);
  const s = store.use();
  const picker = useFilePicker('.json', (f) => readFileText(f, act.loadFromText));

  return (
    <div className="flex shrink-0 flex-wrap justify-center gap-2 border-slate-800 border-t pt-1.5 pb-0.5">
      <Button
        icon={<IconDownload size={14} />}
        tooltip="Save the rule set (mode + rules) to a JSON file"
        shortcut="multiColor.save"
        onClick={act.saveToFile}
      >
        Save
      </Button>
      <Button
        icon={<IconUpload size={14} />}
        tooltip="Load a rule set from a JSON file (replaces the current rules)"
        shortcut="multiColor.load"
        onClick={picker.open}
      >
        Load
      </Button>
      <Button
        icon={<IconTrash size={14} />}
        disabled={s.rules.length === 0}
        tooltip="Delete every rule (the run mode is kept)"
        shortcut="multiColor.clear"
        onClick={act.clearRules}
      >
        Delete all
      </Button>
      <Button
        icon={<IconEraser size={14} />}
        tooltip="Unhide all + reset every color and opacity override on the model (the rules are kept)"
        shortcut="selection.clearOverrides"
        onClick={() => void viewerActions.clearAllOverrides()}
      >
        Reset all
      </Button>
      {picker.element}
    </div>
  );
}
