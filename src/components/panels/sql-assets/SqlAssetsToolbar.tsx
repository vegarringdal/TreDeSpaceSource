import { IconTrash, IconUpload } from '@tabler/icons-react';
import { Button, Select, useMultiFilePicker } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import { sqlAssetsActions as act } from '../../../state/sqlAssets/sqlAssets.actions';
import { sqlAssetsState } from '../../../state/sqlAssets/sqlAssets.state';
import { MAIN_STORE, storesState } from '../../../state/stores/stores.state';
import { dialogs } from '../../dialogs/dialogs.actions';
import { registerSqlImport } from './sqlAssetsPanel';

const DB_ACCEPT = '.db,.sqlite,.sqlite3,.db3,.sqlite-db';

/** The unified SQL Assets toolbar: import destination + import/delete over
 *  the one global selection, plus select all/none. */
export function SqlAssetsToolbar() {
  const { dbs, selected, busy } = sqlAssetsState.use();
  const { stores } = storesState.use();
  const [importStore, setImportStore] = useState(MAIN_STORE);
  const selCount = dbs.filter((d) => selected[d.path]).length;
  const picker = useMultiFilePicker(DB_ACCEPT, (files) => void act.importDatabases(files, importStore));

  useEffect(() => {
    registerSqlImport(picker.open);
    return () => registerSqlImport(null);
  }, [picker.open]);

  const handleDelete = () => {
    void dialogs.confirm(`Delete ${selCount} database(s) from their store(s)?`, { okLabel: 'Delete' }).then((ok) => {
      if (ok) {
        void act.deleteSelected();
      }
    });
  };

  return (
    <>
      {picker.element}
      <label
        className="flex shrink-0 items-center gap-2 text-slate-300 text-xs"
        data-tooltip="Which store (plant) Import Database copies files into"
      >
        <span className="w-14 shrink-0 text-slate-400">Import to</span>
        <div className="min-w-0 flex-1">
          <Select
            options={stores.map((s) => ({ value: s.name, label: s.name }))}
            value={importStore}
            onChange={(v) => setImportStore(v ?? MAIN_STORE)}
          />
        </div>
      </label>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          icon={<IconUpload size={14} />}
          className="h-auto min-h-6 flex-1 py-1 leading-tight"
          disabled={busy}
          shortcut="sql.import"
          onClick={picker.open}
          tooltip={`Copy one or more SQLite files into "${importStore}" (locked while other tabs read them)`}
        >
          Import Database
        </Button>
        <Button
          icon={<IconTrash size={14} />}
          className="h-auto min-h-6 flex-1 py-1 leading-tight"
          disabled={busy || selCount === 0}
          shortcut="sql.deleteSelected"
          onClick={handleDelete}
          tooltip="Delete the selected databases from their stores"
        >
          Delete Selected
        </Button>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="flex-1 text-slate-400 text-xs">Selected: {selCount}</span>
        <Button
          className="h-auto min-h-6 py-1 leading-tight"
          disabled={dbs.length === 0 || selCount === dbs.length}
          onClick={() => act.setSelection(dbs.map((d) => d.path))}
          tooltip="Select every database in every store"
        >
          Select all
        </Button>
        <Button
          className="h-auto min-h-6 py-1 leading-tight"
          disabled={selCount === 0}
          onClick={() => act.setSelection([])}
          tooltip="Clear the selection"
        >
          Deselect all
        </Button>
        <Button
          className="h-auto min-h-6 py-1 leading-tight"
          disabled={dbs.length === 0}
          shortcut="sql.collapseAll"
          onClick={() => act.collapseTree()}
          tooltip="Collapse every store in the tree"
        >
          Collapse all
        </Button>
        <Button
          className="h-auto min-h-6 py-1 leading-tight"
          disabled={dbs.length === 0}
          shortcut="sql.expandAll"
          onClick={() => act.expandTree()}
          tooltip="Expand every store in the tree"
        >
          Expand all
        </Button>
      </div>
    </>
  );
}
