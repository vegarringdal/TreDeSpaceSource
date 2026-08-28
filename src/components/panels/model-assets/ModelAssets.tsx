import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { Button } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import { assetsActions as act, assetsActions } from '../../../state/assets/assets.actions';
import { storesActions } from '../../../state/stores/stores.actions';
import { DataStoresHeader, StoreAdmin } from '../shared/StoreAdmin';
import { AssetsLibraryTree } from './AssetsLibraryTree';
import { StoreActionRows } from './StoreActionRows';
import { StoreSelectionRows } from './StoreSelectionRows';
import { registerAssetsSearchExact } from './stagingSelect';
import { useAssetsLibrary } from './useAssetsLibrary';

/** Model Assets: the imported library in OPFS (model_assets/<store>/) as ONE
 *  tree — every store (project) is a dimmed section band, non-main stores
 *  start collapsed, search and selection span all of them. Importing lives in
 *  the Import Manager panel. */
export function ModelAssets() {
  useMinSize(330, 320);
  const [exact, setExact] = useState(false); // = exact match, * contains (shared)
  const m = useAssetsLibrary(exact);

  useEffect(() => {
    void storesActions.init().then(() => act.init());
  }, []);

  useEffect(() => {
    registerAssetsSearchExact(() => setExact((e) => !e));
    return () => {
      registerAssetsSearchExact(null);
    };
  });

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 p-2">
        <StoreAdmin />
        <DataStoresHeader />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-2 pb-2">
        {m.totalAssets === 0 ? (
          <p className="note px-1 py-2 text-center text-slate-500">
            No assets yet — import into a store from the Import Manager panel.
          </p>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                className="h-auto min-h-6 flex-1 py-1 leading-tight"
                shortcut="assets.collapseAll"
                onClick={() => assetsActions.collapseTree()}
                tooltip="Collapse every store and folder in the tree"
              >
                Collapse all
              </Button>
              <Button
                className="h-auto min-h-6 flex-1 py-1 leading-tight"
                shortcut="assets.expandAll"
                onClick={() => assetsActions.expandTree()}
                tooltip="Expand every store and folder in the tree"
              >
                Expand all
              </Button>
            </div>
            <StoreActionRows visibleIds={m.visibleIds} />
            <StoreSelectionRows
              visibleAssetIds={m.visibleAssets.map((a) => a.id)}
              visibleSelectedCount={m.visibleIds.length}
              selCount={m.selCount}
              query={m.query}
              onQueryChange={m.setQuery}
              exact={exact}
              onToggleExact={() => setExact((e) => !e)}
              onSelect={m.setSelection}
            />
            <AssetsLibraryTree m={m} />
          </>
        )}
      </div>
    </PanelBody>
  );
}
