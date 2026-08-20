// State snapshot (.tdsnap) actions: save streams the current per-item
// color/opacity/visibility/transform state from the modeldb worker straight
// into OPFS (one block per model) and downloads the finished file; load hands
// the picked File to the worker, which applies it block-at-a-time with
// REPLACE semantics per selected channel. Items are matched by a stable
// FNV-1a-64 hash of their fullname within each model's folder/name block, so
// a snapshot survives reload, re-import, and even folder moves of the app —
// as long as the source fullnames are unchanged.
import * as Comlink from 'comlink';
import { clearDir, exportTempDir } from '../../../lib/opfs/opfs';
import { db } from '../../../state/viewer/db';
import { applyWorkerStateResult } from '../../../state/viewer/viewer.actions';
import { dialogs } from '../../dialogs/dialogs.actions';
import { consoleActions } from '../console/console.actions';
import { downloadFromTemp } from './export.actions';
import { exportState } from './export.state';

const TMP = 'temp/export';
const TITLE = 'State snapshot';

const secs = (t0: number) => `${((performance.now() - t0) / 1000).toFixed(1)} s`;
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

function reportError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  consoleActions.log('error', `Snapshot failed: ${msg}`);
  dialogs.error(`Snapshot failed: ${msg}`, TITLE);
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

export const snapshotActions = {
  /** Save the current scene state to a downloaded .tdsnap file. */
  async save() {
    const t0 = performance.now();
    const s = exportState.get();
    if (!s.snapColor && !s.snapTransform) {
      dialogs.error('Pick at least one channel (colors and/or transforms) to save.', TITLE);
      return;
    }
    if ((await db.modelNames()).length === 0) {
      dialogs.error('No models are loaded — nothing to snapshot.', TITLE);
      return;
    }
    try {
      await clearDir(await exportTempDir());
      dialogs.loading('Writing the state snapshot…', TITLE, 0);
      const fileName = `state-${stamp()}.tdsnap`;
      const res = await db.saveSnapshot(
        {
          opfsOut: `${TMP}/${fileName}`,
          scope: s.snapModifiedOnly ? 'modified' : 'all',
          color: s.snapColor,
          transform: s.snapTransform,
          skipWhite: s.snapSkipWhite,
          skipHidden: s.snapSkipHidden,
          store: s.snapStore,
        },
        Comlink.proxy((done: number, total: number) =>
          dialogs.loading(`Model ${Math.min(done + 1, total)} of ${total}…`, TITLE, total ? done / total : 0),
        ),
      );
      if (res.records === 0) {
        dialogs.error('Nothing to snapshot — no item has an override, hidden flag, or transform.', TITLE);
        return;
      }
      dialogs.loading('Starting the download…', TITLE, 0.95);
      await downloadFromTemp(fileName);
      consoleActions.log(
        'info',
        `Snapshot: ${res.records.toLocaleString()} record(s) across ${res.models} model(s), ${mb(res.size)} in ${secs(t0)}`,
      );
    } catch (e) {
      reportError(e);
    } finally {
      dialogs.hideLoading();
    }
  },

  /** Apply a picked .tdsnap file to the loaded scene (REPLACE per channel). */
  async load(file: File) {
    const t0 = performance.now();
    const s = exportState.get();
    if (!s.snapApplyColor && !s.snapApplyTransform) {
      dialogs.error('Pick at least one channel (colors and/or transforms) to apply.', TITLE);
      return;
    }
    const channels = [
      s.snapApplyColor ? 'color/opacity/visibility overrides' : null,
      s.snapApplyTransform ? 'transforms' : null,
    ]
      .filter(Boolean)
      .join(' and ');
    const ok = await dialogs.confirm(
      `Applying "${file.name}" REPLACES all current ${channels} and clears their undo history. Continue?`,
    );
    if (!ok) {
      return;
    }
    try {
      dialogs.loading('Applying the state snapshot…', TITLE, 0);
      const res = await db.applySnapshot(
        file,
        {
          color: s.snapApplyColor,
          transform: s.snapApplyTransform,
          skipWhite: s.snapApplySkipWhite,
          skipHidden: s.snapApplySkipHidden,
          store: s.snapApplyStore,
        },
        Comlink.proxy((done: number, total: number) =>
          dialogs.loading('Applying the state snapshot…', TITLE, total ? done / total : 0),
        ),
      );
      if (!res.appliedColor && !res.appliedTransform) {
        dialogs.error('The file contains none of the selected channels — nothing was changed.', TITLE);
        return;
      }
      await applyWorkerStateResult(res.updates, res.transforms);
      const summary =
        `Snapshot: applied ${res.recordsApplied.toLocaleString()} record(s) to ${res.blocksMatched} of ` +
        `${res.blocksTotal} model(s) in ${secs(t0)}` +
        (res.recordsUnmatched > 0 ? `; ${res.recordsUnmatched.toLocaleString()} record(s) had no matching item` : '');
      consoleActions.log('info', summary);
      const warnings: string[] = [];
      if (res.skippedModels.length > 0) {
        const listed = res.skippedModels
          .slice(0, 10)
          .map((x) => `${x.store ? `${x.store}: ` : ''}${x.group ? `${x.group}/${x.name}` : x.name}`)
          .join('\n');
        warnings.push(
          `${res.skippedModels.length} model(s) in the file had no matching loaded model (not loaded, or outside the picked store) and were skipped:\n${listed}`,
        );
      }
      if (res.poolExhausted) {
        warnings.push(
          'The file holds more distinct transforms than the pool fits (4095) — the overflow was left untransformed.',
        );
      }
      if (warnings.length > 0) {
        dialogs.error(warnings.join('\n\n'), 'Snapshot applied with warnings');
      }
    } catch (e) {
      reportError(e);
    } finally {
      dialogs.hideLoading();
    }
  },
};
