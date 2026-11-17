// Step stills (DESIGN.md › Animation › Capture): one picture per step — at
// its end, everything in place, from the camera row's view there (else the
// view as it is) — with its number, name and text, as a PDF for work
// instructions.

import { toast } from '@treDeSpaceUI/widgets';
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { buildPdf, type PdfPage } from '../../lib/video/pdfWriter';
import { animationDocState } from './animationDoc.state';
import { animationUiActions } from './animationUi.actions';
import { beginCapture, endCapture, grabFrame } from './captureSession';
import { playerActions } from './player.actions';
import { playerState } from './player.state';
import { currentView, holdStep, liveTimeNow, runtimeRenderer } from './runtime';
import { captureCameraPose, setCameraPose } from './runtimeCamera';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const STILL_HEIGHT = 1080;
const JPEG_QUALITY = 0.9;
/** Seconds before a step's end the still is taken (inside its span). */
const BEFORE_END_S = 1e-3;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function jpegOf(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) =>
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)));
      },
      'image/jpeg',
      JPEG_QUALITY,
    ),
  );
}

function download(bytes: Uint8Array<ArrayBuffer>, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const stillsActions = {
  /** A PDF with a page per step of the scene (the mode starts when off). */
  async exportStepStills(): Promise<void> {
    if (!(await animationUiActions.ensureMode())) {
      return;
    }
    const r = runtimeRenderer();
    const v = currentView();
    if (!r || !v || v.steps.length === 0) {
      toast.info('There are no steps to take stills of — add steps on the Steps row first.');
      return;
    }
    const keep = { time: liveTimeNow(), camera: captureCameraPose(r), follow: playerState.get().camera === 'follow' };
    const session = await beginCapture(r, STILL_HEIGHT, true);
    const pages: PdfPage[] = [];
    try {
      for (const [i, step] of v.steps.entries()) {
        dialogs.loading(`Step stills: ${i + 1} of ${v.steps.length}`, 'Export stills', i / v.steps.length);
        // the step's card fully shown, not half way through its fade-out
        holdStep(step.id);
        const frame = await grabFrame(session, Math.max(step.start, step.end - BEFORE_END_S), {
          quality: 'best',
          overlays: true,
        });
        const jpeg = await jpegOf(frame);
        if (jpeg) {
          pages.push({
            jpeg,
            width: session.width,
            height: session.height,
            title: `${i + 1}. ${step.name || 'Step'}`,
            text: step.text,
          });
        }
      }
    } finally {
      holdStep(null);
      dialogs.hideLoading();
      await endCapture(session);
      playerActions.seek(keep.time);
      if (!keep.follow) {
        playerActions.userTookCamera();
        setCameraPose(r, keep.camera);
      }
    }
    if (pages.length === 0) {
      dialogs.error('No stills could be taken (the 3D view gave no picture).', 'Export stills');
      return;
    }
    const name = animationDocState.get().doc.name || 'animation';
    download(buildPdf(pages), `${name}-steps.pdf`);
    toast.success(`Step stills saved: ${pages.length} page(s).`);
  },
};
