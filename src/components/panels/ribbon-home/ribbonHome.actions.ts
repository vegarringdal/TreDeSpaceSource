import { removeViewerOpfsEntries } from '../../../lib/opfs/opfs';
import { clearViewerStorage } from '../../../lib/storageKeys';
import { drawViewportOverlays } from '../../../state/viewer/captureOverlays';
import { labelsActions } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { measurementsActions } from '../../../state/viewer/measurements.actions';
import { measurementsState } from '../../../state/viewer/measurements.state';
import { residency } from '../../../state/viewer/residency';
import { getRenderer, viewerActions } from '../../../state/viewer/viewer.actions';
import { viewerState } from '../../../state/viewer/viewer.state';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';
import { dialogs } from '../../dialogs/dialogs.actions';
import { consoleActions } from '../console/console.actions';
import { type RibbonHomeState, ribbonHomeState } from './ribbonHome.state';

const log = (label: string) => consoleActions.log('info', `Home → ${label}`);

export const ribbonHomeActions = {
  remove: () => void viewerActions.removeAll(),
  hideBar: () => log('Hide bar'),

  setCamera(camera: RibbonHomeState['camera']) {
    ribbonHomeState.set({ camera });
    viewerActions.setProjection(camera === 'ortho');
  },
  /** Grab the rendered frame (incl. the view cube overlay) and download a PNG.
   *  DOM/SVG overlays (measurements, clip gizmo) are rasterised on top —
   *  they live outside the GPU canvas. */
  async screenshot() {
    const r = getRenderer();
    if (!r?.canvasEl) {
      return;
    }
    dialogs.loading('Please wait — generating screenshot…', 'Screenshot');
    try {
      await ribbonHomeActions.screenshotInner();
    } finally {
      dialogs.hideLoading();
    }
  },

  /** Capture the converged presented frame + overlays as a PNG. snapshotHiRes()
   *  raises the render scale to ~4K, waits until TAA/AO have fully accumulated,
   *  and copies the post output (edges, AA, AO, view cube included) — so the PNG
   *  is a higher-resolution, anti-aliased version of the viewport through the
   *  same pixel-tuned pipeline (not a broken off-screen re-render). Shared by the
   *  download button and the postMessage `view.screenshot` command. */
  async captureScreenshotBlob(): Promise<{ blob: Blob; width: number; height: number } | null> {
    const r = getRenderer();
    if (!r?.canvasEl) {
      return null;
    }
    // the 4K capture reallocates every render target for its duration; that
    // transient must not read as budget pressure and evict geometry
    residency.pause();
    let shot: Awaited<ReturnType<typeof r.snapshotHiRes>>;
    try {
      shot = await r.snapshotHiRes();
    } finally {
      residency.resume();
    }
    const canvas = document.createElement('canvas');
    canvas.width = shot.w;
    canvas.height = shot.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    // copy: ImageData wants a plain-ArrayBuffer-backed clamped array
    ctx.putImageData(new ImageData(new Uint8ClampedArray(shot.rgba), shot.w, shot.h), 0, 0);
    const shotW = shot.w;
    const shotH = shot.h;
    await drawViewportOverlays(ctx, shotW, shotH);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob ? { blob, width: shotW, height: shotH } : null;
  },

  async screenshotInner() {
    const shot = await ribbonHomeActions.captureScreenshotBlob();
    if (!shot) {
      return;
    }
    const url = URL.createObjectURL(shot.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tredespace-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    a.click();
    URL.revokeObjectURL(url);
    log('Screenshot');
  },

  /** Reset → Clear all: wipe EVERY local save — localStorage (settings,
   *  layout, hotkeys, viewpoints, color rules…) AND the whole OPFS store
   *  (imported assets) — then reload into a factory-fresh app. */
  async wipeAllLocal() {
    const ok = await dialogs.confirm(
      'Wipe ALL locally saved data? Settings, layout, hotkeys, viewpoints, color rules AND every imported asset (browser storage) are erased. The app reloads afterwards.',
      { title: 'Wipe all local data', okLabel: 'Wipe everything' },
    );
    if (!ok) {
      return;
    }
    // only the viewer's own OPFS entries and tds: keys — a host page sharing
    // the origin (a path-proxied viewer) keeps its storage
    await removeViewerOpfsEntries();
    clearViewerStorage();
    location.reload();
  },

  /** Reset → Clear labels: deletes the SCENE labels only. A live viewpoint's
   *  labels are never deleted — they are muted instead (the parked scene set
   *  is what gets cleared). */
  async deleteLabels() {
    const ok = await dialogs.confirm('Delete every scene label? Viewpoint labels are kept (muted, not deleted).', {
      okLabel: 'Delete',
    });
    if (!ok) {
      return;
    }
    if (viewpointsState.get().liveSide === 'viewpoint') {
      labelsState.set({ muted: true });
      viewpointsState.set((s) => ({ stash: { labels: [], measurements: s.stash?.measurements ?? [] } }));
      log('Scene labels deleted; viewpoint labels muted (kept)');
      return;
    }
    labelsActions.clearAll();
    log('Labels deleted');
  },

  /** Reset → Clear measurements: the measurement twin of deleteLabels. */
  async deleteMeasurements() {
    const ok = await dialogs.confirm(
      'Delete every scene measurement? Viewpoint measurements are kept (muted, not deleted).',
      { okLabel: 'Delete' },
    );
    if (!ok) {
      return;
    }
    if (viewpointsState.get().liveSide === 'viewpoint') {
      measurementsState.set({ muted: true });
      viewpointsState.set((s) => ({ stash: { labels: s.stash?.labels ?? [], measurements: [] } }));
      log('Scene measurements deleted; viewpoint measurements muted (kept)');
      return;
    }
    measurementsActions.clear();
    log('Measurements deleted');
  },

  resetPanels: () => log('Reset panels'),
  togglePanel(key: keyof RibbonHomeState['panels']) {
    const panels = { ...ribbonHomeState.get().panels };
    panels[key] = !panels[key];
    ribbonHomeState.set({ panels });
    log(`Panel ${key} → ${panels[key] ? 'shown' : 'hidden'}`);
  },
};

// keep the ribbon's Persp/Ortho highlight in sync when the projection is
// changed elsewhere (e.g. settings reset)
viewerState.subscribe(() => {
  const camera = viewerState.get().orthographic ? 'ortho' : 'persp';
  if (ribbonHomeState.get().camera !== camera) {
    ribbonHomeState.set({ camera });
  }
});
