// Export panel actions: GPU geometry readback → worker assembly streamed into
// OPFS (temp/export/) → download the finished file from disk. The heavy work
// (GLB/IFC assembly in the modeldb worker, the .tdp cook in a cooker worker)
// never blocks the main thread, and the loading dialog shows staged progress.
// Exports WHAT IS VISIBLE with the CURRENT colors/opacity/transforms.
import * as Comlink from 'comlink';
import type { CookerApi } from '../../../lib/cooker/cookerWorker';
import type { ExportGeom } from '../../../lib/modeldb/modeldbWorker';
import { clearDir, exportTempDir } from '../../../lib/opfs/opfs';
import { db, transfer } from '../../../state/viewer/db';
import { getRenderer } from '../../../state/viewer/viewer.actions';
import { dialogs } from '../../dialogs/dialogs.actions';
import { consoleActions } from '../console/console.actions';
import { exportState } from './export.state';

/** OPFS scratch dir the workers stream into (path from the OPFS root). */
const TMP = 'temp/export';

/** Read every live model's packed geometry back from the GPU (shared by all
 *  exports; must run on the main thread — the renderer owns the device).
 *  Fills the progress bar's first half. Returns null (after an error dialog)
 *  when empty. */
async function readGeoms(title: string): Promise<ExportGeom[] | null> {
  const r = getRenderer();
  if (!r) {
    return null;
  }
  const live = r.liveModels();
  if (live.length === 0) {
    dialogs.error('No models are loaded — nothing to export.', 'Export');
    return null;
  }
  const geoms: ExportGeom[] = [];
  for (const { index } of live) {
    dialogs.loading(
      `Reading model ${geoms.length + 1} of ${live.length} from the GPU…`,
      title,
      (0.5 * geoms.length) / live.length,
    );
    const g = await r.readModelGeometry(index);
    if (!g) {
      continue;
    }
    geoms.push({
      model: index,
      meshletCount: g.meshletCount,
      positionsQ: g.positionsQ,
      indices16: g.indices16,
      cull: g.cull,
      meshletInfo: g.meshletInfo,
      cgColors: g.cgColors,
    });
  }
  return geoms;
}

const geomTransfers = (geoms: ExportGeom[]) =>
  geoms.flatMap((g) => [g.positionsQ, g.indices16, g.cull, g.meshletInfo, g.cgColors]);

/** Trigger a download for a finished export file straight from OPFS — the
 *  blob streams from disk, nothing is copied into JS memory. The file stays in
 *  temp/export until the NEXT export clears the dir (deleting immediately
 *  could yank the bytes out from under the still-running download). */
export async function downloadFromTemp(fileName: string) {
  const dir = await exportTempDir();
  const file = await (await dir.getFileHandle(fileName)).getFile();
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const secs = (t0: number) => `${((performance.now() - t0) / 1000).toFixed(1)} s`;

function reportError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  consoleActions.log('error', `Export failed: ${msg}`);
  dialogs.error(`Export failed: ${msg}`, 'Export');
}

export const exportActions = {
  /** merged = one primitive per final color (fast viewing);
   *  hierarchy = full entry tree with named nodes + per-item meshes. */
  async exportGlb(mode: 'merged' | 'hierarchy') {
    const t0 = performance.now();
    try {
      await clearDir(await exportTempDir());
      const geoms = await readGeoms('Export GLB');
      if (!geoms) {
        return;
      }
      dialogs.loading('Building the GLB (visibility, colors, transforms)…', 'Export GLB', 0.6);
      const { zUp, recenter } = exportState.get();
      const out = `export-${mode}.glb`;
      const { tris, size } = await db.exportGlb(mode, transfer(geoms, geomTransfers(geoms)), {
        zUp,
        recenter,
        opfsOut: `${TMP}/${out}`,
      });
      dialogs.loading('Starting the download…', 'Export GLB', 0.95);
      await downloadFromTemp(out);
      consoleActions.log(
        'info',
        `Export: ${mode} GLB — ${tris.toLocaleString()} triangles, ${mb(size)} in ${secs(t0)}`,
      );
    } catch (e) {
      reportError(e);
    } finally {
      dialogs.hideLoading();
    }
  },

  /** Cooked TreDeSpace .tdp: the visible scene with its CURRENT colors and
   *  transforms, re-cooked for this app. ONE .tdp PER LOADED MODEL, written
   *  into a directory the user picks with the loaded folder structure mirrored
   *  — per-file cooks stay the size the import pipeline already handles, so
   *  huge scenes export fine. TRUE world coordinates on purpose — Z-up, no
   *  transforms, no wrapper root node — so a re-import lands exactly where the
   *  source models are. Cooks run in a cooker worker, OPFS-to-OPFS. */
  async exportTdp(mode: 'merged' | 'hierarchy') {
    const t0 = performance.now();
    const r = getRenderer();
    if (!r) {
      return;
    }
    const live = r.liveModels();
    if (live.length === 0) {
      dialogs.error('No models are loaded — nothing to export.', 'Export');
      return;
    }
    // pick the output directory FIRST (needs the click's user activation)
    let root: FileSystemDirectoryHandle;
    try {
      root = await (
        window as unknown as { showDirectoryPicker(o?: object): Promise<FileSystemDirectoryHandle> }
      ).showDirectoryPicker({ mode: 'readwrite' });
    } catch {
      return; // cancelled
    }
    const clean = (seg: string) => seg.replace(/[\\/:*?"<>|]/g, '_').trim() || '_';
    const worker = new Worker(new URL('../../../lib/cooker/cookerWorker.ts', import.meta.url), { type: 'module' });
    try {
      await clearDir(await exportTempDir());
      const cooker = Comlink.wrap<CookerApi>(worker);
      const metas = await db.modelMetas(live.map((l) => l.index));
      const used = new Set<string>();
      let totalTris = 0;
      let totalSize = 0;
      let written = 0;
      const N = live.length;
      for (let i = 0; i < N; i++) {
        const label = `Model ${i + 1} of ${N} — ${metas[i].name}`;
        dialogs.loading(`${label}: reading from the GPU…`, 'Export TDP', i / N);
        const g = await r.readModelGeometry(live[i].index);
        if (!g) {
          continue;
        }
        const geom: ExportGeom = {
          model: live[i].index,
          meshletCount: g.meshletCount,
          positionsQ: g.positionsQ,
          indices16: g.indices16,
          cull: g.cull,
          meshletInfo: g.meshletInfo,
          cgColors: g.cgColors,
        };
        dialogs.loading(`${label}: building…`, 'Export TDP', (i + 0.35) / N);
        const tmpGlb = `${TMP}/model-${i}.glb`;
        let tris: number;
        try {
          ({ tris } = await db.exportGlb(mode, transfer([geom], geomTransfers([geom])), {
            zUp: true,
            bareRoot: true,
            recenter: false,
            opfsOut: tmpGlb,
          }));
        } catch {
          continue; // fully hidden model — nothing visible to export
        }
        dialogs.loading(`${label}: cooking…`, 'Export TDP', (i + 0.6) / N);
        const tmpTdp = `model-${i}.tdp`;
        const { size } = await cooker.cookOpfsGlbToTdp(tmpGlb, `${TMP}/${tmpTdp}`);
        dialogs.loading(`${label}: writing…`, 'Export TDP', (i + 0.9) / N);
        // mirror the loaded folder structure; dedupe same-named models
        let dir = root;
        for (const seg of metas[i].group.split('/').filter(Boolean)) {
          dir = await dir.getDirectoryHandle(clean(seg), { create: true });
        }
        const base = clean(metas[i].name.replace(/^\/+/, '').replace(/\.tdp$/i, '')) || `model-${i}`;
        let fileName = `${base}.tdp`;
        for (let n = 2; used.has(`${metas[i].group}/${fileName}`); n++) {
          fileName = `${base} (${n}).tdp`;
        }
        used.add(`${metas[i].group}/${fileName}`);
        const bytes = await (await (await exportTempDir()).getFileHandle(tmpTdp)).getFile();
        const out = await dir.getFileHandle(fileName, { create: true });
        const w = await out.createWritable();
        await w.write(bytes);
        await w.close();
        totalTris += tris;
        totalSize += size;
        written++;
      }
      consoleActions.log(
        'info',
        `Export: ${written} ${mode} .tdp file(s) to "${root.name}" — ${totalTris.toLocaleString()} triangles, ${mb(totalSize)} in ${secs(t0)}`,
      );
    } catch (e) {
      reportError(e);
    } finally {
      worker.terminate();
      dialogs.hideLoading();
    }
  },

  /** IFC4, triangulated, TRUE world positions (never recentered — BIM
   *  coordination needs real coordinates). merged = proxy per color;
   *  hierarchy = the app's tree as nested aggregates. */
  async exportIfc(mode: 'merged' | 'hierarchy') {
    const t0 = performance.now();
    try {
      await clearDir(await exportTempDir());
      const geoms = await readGeoms('Export IFC');
      if (!geoms) {
        return;
      }
      dialogs.loading(`Building the IFC (triangulated, ${mode})…`, 'Export IFC', 0.6);
      const out = `export-${mode}.ifc`;
      const { tris, size } = await db.exportIfc(mode, transfer(geoms, geomTransfers(geoms)), {
        opfsOut: `${TMP}/${out}`,
      });
      dialogs.loading('Starting the download…', 'Export IFC', 0.95);
      await downloadFromTemp(out);
      consoleActions.log(
        'info',
        `Export: ${mode} IFC — ${tris.toLocaleString()} triangles, ${mb(size)} in ${secs(t0)}`,
      );
    } catch (e) {
      reportError(e);
    } finally {
      dialogs.hideLoading();
    }
  },
};
