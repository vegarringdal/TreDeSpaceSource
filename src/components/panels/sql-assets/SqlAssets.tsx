import { IconDatabase, IconFile } from '@tabler/icons-react';
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { FileTree, type TreeDir } from '@treDeSpaceUI/widgets';
import { useEffect } from 'react';
import { sqlAssetsActions as act } from '../../../state/sqlAssets/sqlAssets.actions';
import { type SqlDbEntry, sqlAssetsState } from '../../../state/sqlAssets/sqlAssets.state';
import { storesActions } from '../../../state/stores/stores.actions';
import { storesState } from '../../../state/stores/stores.state';
import { DataStoresHeader, StoreAdmin } from '../shared/StoreAdmin';
import { SqlAssetsToolbar } from './SqlAssetsToolbar';

const BYTES_PER_MB = 1048576;

/** One section band per store, its databases as flat file rows (paths are the
 *  real OPFS paths — the tree row IS what ATTACH DATABASE takes). */
function buildDbTree(storeNames: string[], dbs: SqlDbEntry[]): TreeDir {
  const root: TreeDir = { kind: 'dir', name: '', path: '', children: [] };
  for (const store of storeNames) {
    root.children.push({
      kind: 'dir',
      name: store,
      path: `store:${store}`,
      variant: 'section',
      icon: <IconDatabase size={13} className="shrink-0 text-slate-500" />,
      children: dbs
        .filter((d) => d.store === store)
        .map((d) => ({
          kind: 'file',
          name: d.fileName,
          path: d.path,
          note: `${(d.size / BYTES_PER_MB).toFixed(2)} MB`,
        })),
    });
  }
  return root;
}

/** SQL Assets: the SQLite library in OPFS (sql_assets/<store>/<file>), sharing
 *  its stores with Model Assets and presented the same way — ONE tree with a
 *  dimmed section band per store, one selection across all of them. Unlike
 *  models these are real files in real directories: a row's path is exactly
 *  what you write in ATTACH DATABASE. Importing happens here, not in the
 *  Import Manager. */
export function SqlAssets() {
  useMinSize(260, 260);
  const { stores } = storesState.use();
  const { dbs, selected, treeCollapseSignal, treeExpandSignal } = sqlAssetsState.use();
  const storeNames = stores.map((s) => s.name);
  const selectedSet = new Set(dbs.filter((d) => selected[d.path]).map((d) => d.path));

  useEffect(() => {
    void storesActions.init().then(() => act.refresh());
  }, []);

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 p-2">
        <StoreAdmin />
        <DataStoresHeader />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-2 pb-2">
        <SqlAssetsToolbar />
        <FileTree
          key={storeNames.join('|')}
          className="min-h-24 flex-1"
          emptyText="No databases yet — Import Database copies SQLite files into a store."
          root={buildDbTree(storeNames, dbs)}
          selected={selectedSet}
          onSelect={(next) => act.setSelection(next)}
          defaultCollapsed={storeNames.map((s) => `store:${s}`)}
          collapseAllSignal={treeCollapseSignal}
          expandAllSignal={treeExpandSignal}
          fileIcon={<IconFile size={13} className="shrink-0 text-slate-400" />}
        />
        <p className="note m-0 shrink-0 text-slate-500">
          Files live in <code>sql_assets/&lt;store&gt;/</code> — that path is what ATTACH DATABASE takes.
        </p>
      </div>
    </PanelBody>
  );
}
