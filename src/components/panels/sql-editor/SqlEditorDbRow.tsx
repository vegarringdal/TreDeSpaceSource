import { Button, Select } from '@treDeSpaceUI/widgets';
import { sqlAssetsState } from '../../../state/sqlAssets/sqlAssets.state';
import { sqlEditorActions as act } from '../../../state/sqlAssets/sqlEditor.actions';
import { sqlEditorState } from '../../../state/sqlAssets/sqlEditor.state';
import { openSqlAssetsPanel } from '../sql-assets/sqlAssetsPanel';

/** The editor's main-db row: pick the database opened directly (or None for
 *  attach-only runs) and jump to the SQL Assets panel. */
export function SqlEditorDbRow() {
  const { dbs } = sqlAssetsState.use();
  const { draft } = sqlEditorState.use();

  return (
    <label className="flex shrink-0 items-center gap-2 text-slate-400 text-xs">
      <span className="w-[70px] shrink-0">Main db</span>
      <div
        className="min-w-0 flex-1"
        data-tooltip="The database opened directly. Pick None to run purely off ATTACH'd files (an in-memory scratch db is used)."
      >
        <Select
          value={draft.db}
          placeholder={dbs.length ? 'Pick a database…' : 'No databases — import one in SQL Assets'}
          searchable
          options={[
            { value: '', label: '(None — attach only)' },
            ...dbs.map((d) => ({ value: d.path, label: d.fileName, hint: d.store })),
          ]}
          onChange={(v) => act.setMainDbPath(v ?? '')}
        />
      </div>
      <Button
        shortcut="sql.assets"
        tooltip="Open the SQL Assets panel to import or delete databases"
        onClick={() => openSqlAssetsPanel()}
      >
        Assets
      </Button>
    </label>
  );
}
