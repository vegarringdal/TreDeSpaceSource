// A frame-by-frame capture of the animation (video export, step stills):
// the viewer is put in a quiet capture state — one render size, no view
// cube, no selection or hover, overlays as asked, residency paused (resizes
// for the capture are not budget pressure) — and each frame is seeked,
// synced with the worker, snapshot (converged in Best quality), its overlays
// composited as screenshots do, and scaled into an output canvas. `end`
// gives the viewer its state back.

import type { Renderer } from '../../lib/render/renderer';
import { drawViewportOverlays } from '../viewer/captureOverlays';
import { db } from '../viewer/db';
import { residency } from '../viewer/residency';
import { viewerActions } from '../viewer/viewer.actions';
import { playerActions } from './player.actions';
import { playerState } from './player.state';
import { setCaptureMode } from './runtime';
import { whenVisibilitySynced } from './runtimeVisibility';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export interface CaptureSession {
  r: Renderer;
  /** what the capture changed, given back by endCapture */
  keep: { cameraOff: boolean; selection: string[] | null };
  width: number;
  height: number;
  /** the scaled output frame (the last one grabbed) */
  out: HTMLCanvasElement;
  /** the full-size snapshot, reused frame to frame */
  shot: HTMLCanvasElement;
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

/** Frame shape when the 3D view has no canvas to measure. */
const DEFAULT_ASPECT = 16 / 9;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Put the viewer in capture state for frames `height` px tall (width from
 *  the 3D view's aspect, both even). */
export async function beginCapture(r: Renderer, height: number, overlays: boolean): Promise<CaptureSession> {
  const c = r.canvasEl;
  const aspect = c ? c.clientWidth / Math.max(1, c.clientHeight) : DEFAULT_ASPECT;
  const h = even(height);
  const w = even(h * aspect);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const keep = {
    cameraOff: playerState.get().cameraOff,
    selection: (await db.animActorFromSelection())?.fullnames ?? null,
  };
  playerActions.pause();
  playerActions.followCamera();
  await viewerActions.clearSelection();
  r.setHoverItem(null);
  r.hideViewCube = true;
  r.holdCaptureSize(Math.max(w, h));
  setCaptureMode({ overlays });
  residency.pause();
  return { r, keep, width: w, height: h, out, shot: document.createElement('canvas') };
}

/** The frame at timeline time T (after `beforeShot`, e.g. a camera glide),
 *  scaled into `session.out`. */
export async function grabFrame(
  session: CaptureSession,
  T: number,
  o: { quality: 'draft' | 'best'; overlays: boolean; beforeShot?: () => void },
): Promise<HTMLCanvasElement> {
  playerActions.seek(T);
  await nextFrame();
  o.beforeShot?.();
  await nextFrame();
  await whenVisibilitySynced();
  const shot = await session.r.snapshot({ anyFrame: o.quality === 'draft' });
  const shotCanvas = session.shot;
  if (shotCanvas.width !== shot.w || shotCanvas.height !== shot.h) {
    shotCanvas.width = shot.w;
    shotCanvas.height = shot.h;
  }
  const shotCtx = shotCanvas.getContext('2d');
  const outCtx = session.out.getContext('2d');
  if (!shotCtx || !outCtx) {
    return session.out;
  }
  shotCtx.putImageData(new ImageData(new Uint8ClampedArray(shot.rgba), shot.w, shot.h), 0, 0);
  if (o.overlays) {
    await drawViewportOverlays(shotCtx, shot.w, shot.h, { content: true });
  }
  outCtx.drawImage(shotCanvas, 0, 0, session.width, session.height);
  return session.out;
}

/** Give the viewer its normal state back: Camera keys switched off stay
 *  off, the selection comes back. */
export async function endCapture(session: CaptureSession): Promise<void> {
  residency.resume();
  setCaptureMode(null);
  session.r.holdCaptureSize(null);
  session.r.hideViewCube = false;
  if (session.keep.cameraOff) {
    playerState.set({ cameraOff: true });
  }
  if (session.keep.selection) {
    await viewerActions.selectByFullnames(session.keep.selection);
  }
}
