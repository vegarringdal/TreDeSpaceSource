import { IconDeviceFloppy, IconTrash } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { sqlEditorActions as act } from '../../../state/sqlAssets/sqlEditor.actions';
import { sqlEditorState } from '../../../state/sqlAssets/sqlEditor.state';

/** The editor's top row: Clear (empties the draft after a confirm) and Save
 *  Local (adds the draft to SQL Reports — needs a Main db, which decides the
 *  store it lands in). */
export function SqlEditorTopRow() {
  const { draft } = sqlEditorState.use();

  return (
    <div className="flex shrink-0 items-center justify-end gap-2">
      <Button
        icon={<IconTrash size={14} />}
        shortcut="sql.editor.clear"
        tooltip="Empty the editor — name, description, SQL, filters and types (asks first). The Main db pick stays"
        onClick={() => void act.clear()}
      >
        Clear
      </Button>
      <Button
        icon={<IconDeviceFloppy size={14} />}
        disabled={!draft.db}
        shortcut="sql.editor.saveLocal"
        tooltip="Add the current draft to SQL Reports as a new report, saved in the Main db's store — pick a Main db first"
        onClick={() => void act.saveLocal()}
      >
        Save Local
      </Button>
    </div>
  );
}
