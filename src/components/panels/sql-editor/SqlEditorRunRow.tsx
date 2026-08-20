import { IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { sqlEditorActions as act } from '../../../state/sqlAssets/sqlEditor.actions';
import { sqlEditorState } from '../../../state/sqlAssets/sqlEditor.state';

/** The Run / lockmode / Kill row — executes the script or terminates the
 *  SQLite worker (which also releases its file locks). */
export function SqlEditorRunRow() {
  const { lockmode, running } = sqlEditorState.use();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        icon={<IconPlayerPlay size={14} />}
        className="flex-1"
        disabled={running}
        shortcut="sql.run"
        tooltip="Run the script (Ctrl+Enter in the editor) — results go to the Console panel"
        onClick={() => void act.run()}
      >
        Run
      </Button>
      <Button
        active={lockmode === 'exclusive'}
        shortcut="sql.lockmode"
        tooltip="Exclusive = writes allowed, one tab at a time. Shared = read-only, several readers at once."
        onClick={act.toggleLockmode}
      >
        {lockmode === 'exclusive' ? 'Exclusive' : 'Shared'}
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
