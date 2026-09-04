import { projectToScreen } from '../../../lib/math/project';
import { removeViewerOpfsEntries } from '../../../lib/opfs/opfs';
import { clearViewerStorage } from '../../../lib/storageKeys';
import { labelsActions } from '../../../state/viewer/labels.actions';
import { labelsState, type SceneLabel } from '../../../state/viewer/labels.state';
import { measurementsActions } from '../../../state/viewer/measurements.actions';
import { measurementsState } from '../../../state/viewer/measurements.state';
import { residency } from '../../../state/viewer/residency';
import { getRenderer, viewerActions } from '../../../state/viewer/viewer.actions';
import { viewerState } from '../../../state/viewer/viewer.state';
import { viewpointsActions } from '../../../state/viewer/viewpoints.actions';
import { viewpointsState } from '../../../state/viewer/viewpoints.state';
import { dialogs } from '../../dialogs/dialogs.actions';
import { consoleActions } from '../console/console.actions';
import { emptyMultiColorState, multiColorState } from '../multi-color/multiColor.state';
import { type RibbonHomeState, ribbonHomeState } from './ribbonHome.state';

const log = (label: string) => consoleActions.log('info', `Home → ${label}`);

/** Rich-text line → [text, bold] segments (matches the label overlay's **bold**). */
function boldSegments(line: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  let bold = false;
  for (const part of line.split('**')) {
    if (part) {
      out.push([part, bold]);
    }
    bold = !bold;
  }
  return out;
}

/** Draw the scene labels (leader lines + boxes) onto the screenshot canvas —
 *  they are HTML, not SVG, so the SVG-overlay compositor misses them. */
function drawLabels(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
  const r = getRenderer();
  if (!r?.canvasEl) {
    return;
  }
  const s = labelsState.get();
  if (s.items.length === 0) {
    return;
  }
  const w = r.canvasEl.clientWidth;
  const h = r.canvasEl.clientHeight;
  const at = (l: SceneLabel) => projectToScreen(r.viewProjMatrix, w, h, l.anchor);
  // leader lines + anchor dots first (labels draw on top, like the DOM order)
  for (const l of s.items) {
    const a = at(l);
    if (!a || (l.offset[0] === 0 && l.offset[1] === 0)) {
      continue;
    }
    ctx.strokeStyle = s.leaderColor;
    ctx.fillStyle = s.leaderColor;
    ctx.lineWidth = 1.5 * sx;
    ctx.beginPath();
    ctx.moveTo(a[0] * sx, a[1] * sy);
    ctx.lineTo((a[0] + l.offset[0]) * sx, (a[1] + l.offset[1]) * sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a[0] * sx, a[1] * sy, 2.5 * sx, 0, 2 * Math.PI);
    ctx.fill();
  }
  const fontPx = 12 * sx;
  const lineH = 15 * sx;
  const padX = 6 * sx;
  const padY = 2 * sx;
  for (const l of s.items) {
    const a = at(l);
    if (!a) {
      continue;
    }
    const lines = (s.richText ? l.text.split('\n') : [l.text]).map(boldSegments);
    let maxW = 0;
    for (const segs of lines) {
      let lw = 0;
      for (const [text, bold] of segs) {
        ctx.font = `${bold ? 'bold ' : ''}${fontPx}px sans-serif`;
        lw += ctx.measureText(text).width;
      }
      maxW = Math.max(maxW, lw);
    }
    const bw = maxW + padX * 2;
    const bh = lines.length * lineH + padY * 2;
    const x0 = (a[0] + l.offset[0]) * sx - bw / 2;
    const y0 = (a[1] + l.offset[1]) * sy - bh / 2;
    ctx.globalAlpha = l.opacity;
    ctx.fillStyle = l.bg;
    ctx.fillRect(x0, y0, bw, bh);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1 * sx;
    ctx.strokeRect(x0, y0, bw, bh);
    ctx.fillStyle = l.textColor;
    ctx.textBaseline = 'middle';
    lines.forEach((segs, i) => {
      let x = x0 + padX;
      const y = y0 + padY + lineH * (i + 0.5);
      for (const [text, bold] of segs) {
        ctx.font = `${bold ? 'bold ' : ''}${fontPx}px sans-serif`;
        ctx.fillText(text, x, y);
        x += ctx.measureText(text).width;
      }
    });
    ctx.globalAlpha = 1;
  }
}

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
    // composite the viewport's SVG overlays (CSS px → device px scale)
    const host = r.canvasEl?.parentElement;
    if (host) {
      for (const svg of host.querySelectorAll(':scope > svg')) {
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          continue;
        }
        const clone = svg.cloneNode(true) as SVGSVGElement;
        clone.setAttribute('width', String(rect.width));
        clone.setAttribute('height', String(rect.height));
        const url = URL.createObjectURL(
          new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }),
        );
        try {
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('overlay rasterise failed'));
            img.src = url;
          });
          ctx.drawImage(img, 0, 0, shotW, shotH);
        } catch {
          // overlay skipped — still deliver the base screenshot
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    }
    // scene labels are HTML (not SVG) — draw them directly
    drawLabels(ctx, shotW / Math.max(1, r.canvasEl.clientWidth), shotH / Math.max(1, r.canvasEl.clientHeight));
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
  async clearAllLocal() {
    const ok = await dialogs.confirm(
      'Delete ALL locally saved data? Settings, layout, hotkeys, viewpoints, color rules AND every imported asset (browser storage) are erased. The app reloads afterwards.',
      { title: 'Clear all local data', okLabel: 'Delete everything' },
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

  /** Reset → Clear labels/measurements: MUTE everything shown — scene or
   *  viewpoint side alike — nothing is deleted. Press again to unmute. */
  muteLabelsMeasurements() {
    const allMuted = labelsState.get().muted && measurementsState.get().muted;
    labelsState.set({ muted: !allMuted });
    measurementsState.set({ muted: !allMuted });
    log(allMuted ? 'Labels & measurements shown' : 'Labels & measurements muted');
  },

  /** Reset → Delete labels/measurements: deletes the SCENE sets only. A live
   *  viewpoint's content is never deleted — it is muted instead (the parked
   *  scene sets are what gets cleared). */
  async deleteLabelsMeasurements() {
    const ok = await dialogs.confirm(
      'Delete every scene label and measurement? Viewpoint labels/measurements are kept (muted, not deleted).',
      { okLabel: 'Delete' },
    );
    if (!ok) {
      return;
    }
    if (viewpointsState.get().liveSide === 'viewpoint') {
      // viewpoint content stays — mute it; the scene sets live in the stash
      labelsState.set({ muted: true });
      measurementsState.set({ muted: true });
      viewpointsState.set({ stash: { labels: [], measurements: [] } });
      log('Scene labels/measurements deleted; viewpoint content muted (kept)');
      return;
    }
    labelsActions.clearAll();
    measurementsActions.clear();
    log('Labels & measurements deleted');
  },

  /** Reset → Clear viewpoints: delete every viewpoint (the scene's own
   *  labels/measurements come back first if a viewpoint was live). */
  async clearViewpoints() {
    const n = viewpointsState.get().list.length;
    if (n === 0) {
      return;
    }
    const ok = await dialogs.confirm(`Delete all ${n} viewpoint(s)?`, { okLabel: 'Delete' });
    if (!ok) {
      return;
    }
    if (viewpointsState.get().liveSide === 'viewpoint') {
      viewpointsActions.unmuteScene();
    }
    viewpointsState.set({ list: [], activeId: null, selectedId: null });
    log('Viewpoints cleared');
  },

  /** Reset → Clear the Set Color editor: remove EVERY rule (empty list, not
   *  the one-blank-rule default). */
  clearSetColor() {
    multiColorState.set({ ...emptyMultiColorState(), rules: [] });
    log('Set Color editor cleared');
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
