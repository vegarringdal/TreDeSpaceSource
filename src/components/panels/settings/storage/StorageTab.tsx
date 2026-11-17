import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import { useEffect } from 'react';
import { formatBytes } from '../../../../lib/opfs/storageSpace';
import { assetsState } from '../../../../state/assets/assets.state';
import { storageActions } from '../../../../state/storage/storage.actions';
import { storageState } from '../../../../state/storage/storage.state';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PERCENT = 100;

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/** The storage figures, re-read when the tab opens and when the asset
 *  library grows or shrinks. */
function useStorageStatus() {
  const { status, isReady } = storageState.use();
  const assetCount = assetsState.useSelect((s) => s.assets.length);

  // biome-ignore lint/correctness/useExhaustiveDependencies: assetCount is the trigger, not an input
  useEffect(() => {
    void storageActions.refresh();
  }, [assetCount]);

  return { status, isReady };
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** Settings → Storage tab: whether the browser keeps the imported data, how
 *  much of the quota is used, and the request for persistent storage. */
export function StorageTab() {
  const { status, isReady } = useStorageStatus();

  if (!isReady) {
    return null;
  }

  if (!status) {
    return (
      <Collapsible title="Storage" info="Where imported models, scans and databases are kept.">
        <p className="text-slate-400 text-xs leading-relaxed">This browser does not report its storage.</p>
      </Collapsible>
    );
  }

  const usedPercent = status.quota > 0 ? Math.round((status.usage / status.quota) * PERCENT) : 0;

  return (
    <Collapsible
      title="Storage"
      info={
        <>
          Imported models, scans and databases are kept by this browser, for this site only. Unless the browser has made
          the storage persistent it may clear all of it when the disk runs low. Clearing the site's data in the
          browser's own settings removes it either way. "Keep storage" asks for persistence: Chrome decides by itself
          (it says yes for sites you use often, have bookmarked or installed), Firefox asks you.
        </>
      }
    >
      <div className="flex flex-col gap-1 text-slate-300 text-xs">
        <div>
          {status.isPersistent ? (
            <span className="text-emerald-400">Persistent</span>
          ) : (
            <span className="text-amber-400">Not persistent</span>
          )}
          <span className="text-slate-400">
            {status.isPersistent
              ? ' — the browser will not clear this data by itself.'
              : ' — the browser may clear this data when the disk runs low.'}
          </span>
        </div>
        <div className="text-slate-400">
          {formatBytes(status.usage)} used of {formatBytes(status.quota)} ({usedPercent}%)
        </div>
      </div>
      <div className="mt-1 flex gap-2">
        <Button
          disabled={status.isPersistent}
          onClick={() => void storageActions.requestPersistence()}
          tooltip={
            status.isPersistent
              ? 'Storage is already persistent'
              : 'Ask the browser to keep imported models, scans and databases even when the disk runs low'
          }
          shortcut="settings.storagePersist"
        >
          Keep storage
        </Button>
      </div>
    </Collapsible>
  );
}
