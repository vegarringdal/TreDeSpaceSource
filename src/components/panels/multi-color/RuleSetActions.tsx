import { IconDownload, IconEraser, IconSelectAll, IconTrash, IconUpload } from '@tabler/icons-react';
import { Button, readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { useContext } from 'react';
import { viewerActions } from '../../../state/viewer/viewer.actions';
import { MultiColorCtx } from './multiColorContext';

/** The rule-set row of Set Color's Common section: Save / Load / Delete all,
 *  Select (the rules as a search), Reset all. Wraps onto a second line in a
 *  narrow panel. */
export function RuleSetActions() {
  const { store, act } = useContext(MultiColorCtx);
  const s = store.use();
  const picker = useFilePicker('.json', (f) => readFileText(f, act.loadFromText));
  const hasEnabledRule = s.rules.some((r) => r.enabled);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
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
        icon={<IconSelectAll size={14} />}
        disabled={s.running || !hasEnabledRule}
        tooltip="Select every item the enabled rules match — the rules as a search: nothing is coloured and the run mode is ignored"
        shortcut="multiColor.select"
        onClick={() => void act.select()}
      >
        Select
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
