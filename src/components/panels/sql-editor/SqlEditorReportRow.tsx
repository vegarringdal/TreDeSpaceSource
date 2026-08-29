import { Button } from '@treDeSpaceUI/widgets';
import { sqlEditorActions as act } from '../../../state/sqlAssets/sqlEditor.actions';
import { sqlEditorState } from '../../../state/sqlAssets/sqlEditor.state';

/** Route the current SQL through the report consumers (like a saved report):
 *  SQL Table, the three coloring modes, or the SQL Detail binding. */
export function SqlEditorReportRow() {
  const { running } = sqlEditorState.use();

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      <Button
        disabled={running}
        shortcut="sql.editor.asTable"
        tooltip="Run and show the result in the SQL Table panel. TREE_VIEW_ARGS is seeded from the last viewport pick (like Run and the color buttons), so a detail-style query can be checked here with the values it will really see"
        onClick={() => void act.asTable()}
      >
        As Table
      </Button>
      <Button
        disabled={running}
        shortcut="sql.editor.colorWhite"
        tooltip="Everything white + the result colored (needs a fullname column; fullname_color optional, defaults yellow)"
        onClick={() => void act.colorWhite()}
      >
        Color White
      </Button>
      <Button
        disabled={running}
        shortcut="sql.editor.colorHidden"
        tooltip="Isolate the result: the returned rows colored (fullname_color, defaults yellow), everything else faded to opacity 0 (Reset model in Set Color recovers)"
        onClick={() => void act.colorHidden()}
      >
        Color Hidden
      </Button>
      <Button
        disabled={running}
        shortcut="sql.editor.colorSet"
        tooltip="Run your current Set Color rules + the result appended as one extra Multi rule (fullname_color optional, defaults yellow). Nothing is saved to the Set Color panel."
        onClick={() => void act.colorSet()}
      >
        Color Set
      </Button>
      <Button
        disabled={running}
        shortcut="sql.editor.asDetail"
        tooltip="Bind this SQL to the SQL Detail panel — clicks run it against the clicked hierarchy (use TREE_VIEW_ARGS). ALT+click logs each sent payload to the Console."
        onClick={(e) => act.asDetail(e.altKey)}
      >
        As Detail
      </Button>
    </div>
  );
}
