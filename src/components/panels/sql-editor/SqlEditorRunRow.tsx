import { IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { sqlEditorActions as act } from '../../../state/sqlAssets/sqlEditor.actions';
import { sqlEditorState } from '../../../state/sqlAssets/sqlEditor.state';

/** The Execute / lock mode / Kill row — executes the script or terminates
 *  the SQLite worker (which also releases its file locks). Each button takes
 *  only the width its label needs. */
export function SqlEditorRunRow() {
  const { lockmode, running } = sqlEditorState.use();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        icon={<IconPlayerPlay size={14} />}
        disabled={running}
        shortcut="sql.run"
        tooltip="Execute the script — results go to the Console panel. FILTER_ARGS is seeded from the filters below"
        onClick={() => void act.run()}
      >
        Execute
      </Button>
      <Button
        active={lockmode === 'exclusive'}
        shortcut="sql.lockmode"
        tooltip="Exclusive = writes allowed, one tab at a time. Shared = read-only, several readers at once."
        onClick={act.toggleLockmode}
      >
        {lockmode === 'exclusive' ? 'Exclusive Lock Mode' : 'Shared Lock Mode'}
      </Button>
      <Button
        icon={<IconPlayerStop size={14} />}
        shortcut="sql.kill"
        tooltip="Terminate the SQLite worker — cancels the running query and releases its file locks"
        onClick={act.kill}
      >
        Kill
      </Button>
    </div>
  );
}
