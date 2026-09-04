import { Button } from '@treDeSpaceUI/widgets';
import { sqlEditorActions as act } from '../../../state/sqlAssets/sqlEditor.actions';
import { sqlEditorState } from '../../../state/sqlAssets/sqlEditor.state';
import type { ReportType } from '../../../state/sqlReports/sqlReports.state';

/** Route the current SQL through the report consumers (like a saved report):
 *  the four coloring modes on one row, then SQL Table and the SQL Detail
 *  binding on the next. Each button is enabled only while its output type is
 *  checked in the draft's Types. */
export function SqlEditorReportRow() {
  const { running, draft } = sqlEditorState.use();
  const can = (t: ReportType): boolean => !running && draft.types.includes(t);

  return (
    <>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          disabled={!can('COLORING')}
          shortcut="sql.editor.colorWhite"
          tooltip="Everything white + the result colored (needs a fullname column; fullname_color optional, defaults yellow)"
          onClick={() => void act.colorWhite()}
        >
          Color White
        </Button>
        <Button
          disabled={!can('COLORING')}
          shortcut="sql.editor.colorTransparent"
          tooltip="Like Color White, but the base coat is white at 10% opacity — the rest of the model stays faintly visible behind the colored result"
          onClick={() => void act.colorTransparent()}
        >
          Color Transparent
        </Button>
        <Button
          disabled={!can('COLORING')}
          shortcut="sql.editor.colorHidden"
          tooltip="Isolate the result: the returned rows colored (fullname_color, defaults yellow), everything else faded to opacity 0 (Reset model in Set Color recovers)"
          onClick={() => void act.colorHidden()}
        >
          Color Hidden
        </Button>
        <Button
          disabled={!can('COLORING')}
          shortcut="sql.editor.colorSet"
          tooltip="Run your current Set Color rules + the result appended as one extra Multi rule (fullname_color optional, defaults yellow). Nothing is saved to the Set Color panel."
          onClick={() => void act.colorSet()}
        >
          Color Set
        </Button>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          disabled={!can('TABLE')}
          shortcut="sql.editor.asTable"
          tooltip="Run and show the result in the SQL Table panel. TREE_VIEW_ARGS is seeded from the last selection — tree click, viewport pick or U / P (like Run and the color buttons), so a detail-style query can be checked here with the values it will really see"
          onClick={() => void act.asTable()}
        >
          As Table
        </Button>
        <Button
          disabled={!can('DETAIL')}
          shortcut="sql.editor.asDetail"
          tooltip="Bind this SQL to the SQL Detail panel — clicks run it against the clicked hierarchy (use TREE_VIEW_ARGS). ALT+click logs each sent payload to the Console."
          onClick={(e) => act.asDetail(e.altKey)}
        >
          As Detail
        </Button>
      </div>
    </>
  );
}
