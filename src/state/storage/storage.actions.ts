import { consoleActions } from '../../components/panels/console/console.actions';
import { readStorageStatus, requestPersistentStorage } from '../../lib/opfs/storageSpace';
import { storageState } from './storage.state';

export const storageActions = {
  /** Read usage, quota and whether storage is persistent from the browser. */
  async refresh(): Promise<void> {
    storageState.set({ status: await readStorageStatus(), isReady: true });
  },

  /**
   * Ask the browser to keep this origin's storage, and say in the Console
   * what came of it: a grant the first time it is given, a refusal every
   * time — without the grant the browser may clear every imported model,
   * scan and database when the disk runs low.
   */
  async requestPersistence(): Promise<boolean> {
    const wasPersistent = storageState.get().status?.isPersistent ?? false;
    const isPersistent = await requestPersistentStorage();
    await storageActions.refresh();
    if (!isPersistent) {
      consoleActions.log(
        'warn',
        'Storage: the browser has not made this storage persistent — it may clear imported data when the disk runs low (Settings → Storage)',
      );
    } else if (!wasPersistent) {
      consoleActions.log('info', 'Storage: persistent — the browser will not clear imported data by itself');
    }

    return isPersistent;
  },
};
