// Export panel actions: GPU geometry readback → worker assembly streamed into
// OPFS (temp/export/) → download the finished file from disk. The heavy work
// (GLB/IFC assembly in the modeldb worker, the .tdp cook in a cooker worker)
// never blocks the main thread, and the loading dialog shows staged progress.
// Exports WHAT IS VISIBLE with the CURRENT colors/opacity/transforms — at FULL
// detail regardless of the VRAM budget: a zone the budget holds coarse, mixed
// or unloaded is read from its full cook on disk instead of the GPU slot.
import * as Comlink from 'comlink';
import type { CookerApi } from '../../../lib/cooker/cookerWorker';
import type { ExportGeom } from '../../../lib/modeldb/modeldbWorker';
import { clearDir, exportTempDir, modelStoreDir, readFile } from '../../../lib/opfs/opfs';
import type { Renderer } from '../../../lib/render/renderer';
import { db, transfer } from '../../../state/viewer/db';
import { residency } from '../../../state/viewer/residency';
import { getRenderer } from '../../../state/viewer/viewer.actions';
import { dialogs } from '../../dialogs/dialogs.actions';
import { consoleActions } from '../console/console.actions';
import { exportState } from './export.state';

/** OPFS scratch dir the workers stream into (path from the OPFS root). */
const TMP = 'temp/export';

/** Every model an export covers: the renderer's live slots plus the zones the
 *  VRAM budget has unloaded (their DbModel is live and their full cook is on
 *  disk — an export must not silently drop them). Worker indices, ascending. */
function exportModelIndices(r: Renderer): number[] {
  const indices = new Set(r.liveModels().map((m) => m.index));
  for (const slot of residency.unloadedSlots()) {
    indices.add(slot);
  }
  return [...indices].sort((a, b) => a - b);
}

/** One model's geometry for the export: the GPU readback when the slot holds
 *  full detail (or is not budget-managed), else the zone's full cook from
 *  OPFS — the budget's cuts must never reach an export. */
async function geomFor(r: Renderer, index: number): Promise<{ geom: ExportGeom; fromDisk: boolean } | null> {
  const src = residency.exportSource(index);
  if (src) {
    const tdp = await readFile(await modelStoreDir(src.store), `${src.assetId}.tdp`);
    return { geom: { model: index, tdp }, fromDisk: true };
  }
  const g = await r.readModelGeometry(index);
  if (!g) {
    return null;
  }
  const { name: _name, ...geom } = g;
  return { geom: { model: index, ...geom }, fromDisk: false };
}

/** Read every model's packed geometry (shared by all exports; must run on
 *  the main thread — the renderer owns the device). Fills the progress bar's
 *  first half. Returns null (after an error dialog) when empty. */
async function readGeoms(title: string): Promise<ExportGeom[] | null> {
  const r = getRenderer();
  if (!r) {
    return null;
  }
  const indices = exportModelIndices(r);
  if (indices.length === 0) {
    dialogs.error('No models are loaded — nothing to export.', 'Export');
    return null;
  }
  const geoms: ExportGeom[] = [];
  for (let i = 0; i < indices.length; i++) {
    const fromDisk = residency.exportSource(indices[i]) !== null;
    dialogs.loading(
      `Reading model ${i + 1} of ${indices.length} ${fromDisk ? 'from disk (full detail)' : 'from the GPU'}…`,
      title,
      (0.5 * i) / indices.length,
    );
    const g = await geomFor(r, indices[i]);
    if (g) {
      geoms.push(g.geom);
    }
  }
  return geoms;
}

const geomTransfers = (geoms: ExportGeom[]): ArrayBuffer[] =>
  geoms.flatMap((g) => ('tdp' in g ? [g.tdp] : [g.positionsQ, g.indices16, g.cull, g.meshletInfo, g.cgColors]));

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
    residency.pause(); // no swap may land between listing a zone and reading it
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
      residency.resume();
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
    const indices = exportModelIndices(r);
    if (indices.length === 0) {
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
    residency.pause(); // no swap may land between listing a zone and reading it
    try {
      await clearDir(await exportTempDir());
      const cooker = Comlink.wrap<CookerApi>(worker);
      const metas = await db.modelMetas(indices);
      const used = new Set<string>();
      let totalTris = 0;
      let totalSize = 0;
      let written = 0;
      const N = indices.length;
      for (let i = 0; i < N; i++) {
        const label = `Model ${i + 1} of ${N} — ${metas[i].name}`;
        const fromDisk = residency.exportSource(indices[i]) !== null;
        dialogs.loading(
          `${label}: reading ${fromDisk ? 'from disk (full detail)' : 'from the GPU'}…`,
          'Export TDP',
          i / N,
        );
        const g = await geomFor(r, indices[i]);
        if (!g) {
          continue;
        }
        const geom = g.geom;
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
      residency.resume();
      worker.terminate();
      dialogs.hideLoading();
    }
  },

  /** IFC4, triangulated, TRUE world positions (never recentered — BIM
   *  coordination needs real coordinates). merged = proxy per color;
   *  hierarchy = the app's tree as nested aggregates. */
  async exportIfc(mode: 'merged' | 'hierarchy') {
    const t0 = performance.now();
    residency.pause(); // no swap may land between listing a zone and reading it
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
      residency.resume();
      dialogs.hideLoading();
    }
  },
};
