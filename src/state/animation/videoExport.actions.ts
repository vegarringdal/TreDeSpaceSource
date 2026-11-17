// Video export (DESIGN.md › Animation › Capture): the animation rendered
// offline, frame by frame — seek, wait until the worker has the frame's
// colours, capture the presented frame (converged in Best quality), draw the
// overlays as screenshots do, encode — so the video is smooth however fast
// the machine is. Every scene one after another, or one scene (whole, or a
// part from Start to End). The camera follows the camera row; without
// camera keys the view stays as it is. The scene, time slider and view come
// back after.
// In a hidden tab the browser stops drawing, so the export waits there: the
// tab's title says so, and the encoder hands over its frames before it hides.
// The MP4 streams into a file in the browser's storage (OPFS temp/video) as it
// is made, and the download reads it from there — however long the video,
// it is never held in memory.

import { toast } from '@treDeSpaceUI/widgets';
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { sceneView, stepAt } from '../../lib/animation/scene';
import { type VideoSegment, videoFrameTimes, videoSegments } from '../../lib/animation/videoFrames';
import { downloadBlob } from '../../lib/download';
import { clearDir, videoTempDir } from '../../lib/opfs/opfs';
import type { Result } from '../../lib/result';
import { storageKey } from '../../lib/storageKeys';
import type { Mp4Writer } from '../../lib/video/mp4Writer';
import { animationDocState } from './animationDoc.state';
import { animationUiActions } from './animationUi.actions';
import { animationUiState } from './animationUi.state';
import { beginCapture, endCapture, grabFrame } from './captureSession';
import { playerActions } from './player.actions';
import { playerState } from './player.state';
import { currentView, holdStep, liveTimeNow, runtimeRenderer, syncSessionNow } from './runtime';
import { captureCameraPose, setCameraPose } from './runtimeCamera';
import {
  DEFAULT_VIDEO_SETTINGS,
  type VideoExportSettings,
  type VideoPick,
  videoExportState,
} from './videoExport.state';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const PREFS_KEY = storageKey('videoExport');
/** A frame this close to a pausing step's end is one of its hold frames. */
const HOLD_MATCH_S = 1e-6;
/** The tab's title while the export waits in a hidden tab. */
const WAITING_TITLE = '⏸ Video export waits — open this tab';
/** The file in temp/video the MP4 streams into. */
const TEMP_NAME = 'video.mp4';
const MB = 1024 * 1024;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

let cancelled = false;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function loadSettings(): VideoExportSettings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) {
      return DEFAULT_VIDEO_SETTINGS;
    }
    const s = { ...DEFAULT_VIDEO_SETTINGS };
    const get = (k: string): unknown => (k in raw ? Reflect.get(raw, k) : undefined);
    const height = get('height');
    if (height === 720 || height === 1080 || height === 1440) {
      s.height = height;
    }
    const fps = get('fps');
    if (fps === 24 || fps === 30 || fps === 60) {
      s.fps = fps;
    }
    const quality = get('quality');
    if (quality === 'draft' || quality === 'best') {
      s.quality = quality;
    }
    const scenes = get('scenes');
    if (scenes === 'all' || scenes === 'one') {
      s.scenes = scenes;
    }
    const span = get('span');
    // before scenes: `range` all / step / range — a step or range is a part
    const range = get('range');
    if (span === 'whole' || span === 'part') {
      s.span = span;
    } else if (range === 'step' || range === 'range') {
      s.span = 'part';
    }
    const overlays = get('overlays');
    if (typeof overlays === 'boolean') {
      s.overlays = overlays;
    }
    const holdS = get('holdS');
    if (typeof holdS === 'number' && Number.isFinite(holdS)) {
      s.holdS = Math.min(10, Math.max(0, holdS));
    }
    return s;
  } catch {
    return DEFAULT_VIDEO_SETTINGS;
  }
}

function saveSettings(s: VideoExportSettings): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(s));
  } catch {
    // storage blocked — the settings live for the session
  }
}

/** The Timeline's in / out range (the active scene's), if one is marked. */
function markedRange(): { from: number; to: number } | null {
  const r = animationUiState.get().range;
  return r && r.to - r.from > 0 ? { from: r.from, to: r.to } : null;
}

/** The step at the time slider (the active scene's), if there is one. */
function stepHere(): { from: number; to: number } | null {
  const v = currentView();
  const s = v ? stepAt(v, liveTimeNow()) : null;
  return s ? { from: s.start, to: s.end } : null;
}

/** A fresh pick for the dialog: the active scene, and a part from the in /
 *  out range, else the step at the time slider, else the whole scene. */
function defaultPick(): VideoPick {
  const v = currentView();
  const part = markedRange() ?? stepHere() ?? { from: 0, to: v?.duration ?? 0 };
  return { scene: v?.scene.id ?? '', ...part };
}

/** Why there is nothing to export, for the toast. */
function nothingMessage(s: VideoExportSettings): string {
  if (s.scenes === 'one' && s.span === 'part') {
    return 'Set an End after the Start.';
  }
  return s.scenes === 'all' ? 'Nothing to export: every scene is empty.' : 'Nothing to export: the scene is empty.';
}

/** The pausing step whose end frame T is (its card stays up), else null. */
function holdAt(seg: VideoSegment, T: number): string | null {
  const scene = animationDocState.get().doc.scenes.find((s) => s.id === seg.scene);
  const step = scene?.steps.find((s) => s.pauseAtEnd && Math.abs(s.end - T) < HOLD_MATCH_S);
  return step?.id ?? null;
}

/** Move the player onto `scene` and capture it now (no re-capture may land
 *  between frames). */
async function onScene(scene: string): Promise<void> {
  if (currentView()?.scene.id !== scene) {
    playerActions.switchScene(scene);
    await syncSessionNow({ force: true });
  }
}

/** While the export runs, the tab's title shows how far it is — and, in a
 *  hidden tab (where the browser stops drawing, so nothing is made), that it
 *  waits there. The encoder hands over its frames before the tab hides, and
 *  `onShown` gets the time spent hidden (kept out of the time-left guess). */
function watchTab(writer: Mp4Writer, onShown: (hiddenMs: number) => void) {
  const title = document.title;
  let hiddenAt: number | null = null;
  const onChange = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = performance.now();
      document.title = WAITING_TITLE;
      void writer.settle();
    } else if (hiddenAt !== null) {
      onShown(performance.now() - hiddenAt);
      hiddenAt = null;
    }
  };
  document.addEventListener('visibilitychange', onChange);
  return {
    progress(done: number, total: number): void {
      if (document.visibilityState !== 'hidden') {
        document.title = `${Math.floor((done / Math.max(1, total)) * 100)} % · Video export — ${title}`;
      }
    },
    stop(): void {
      document.removeEventListener('visibilitychange', onChange);
      document.title = title;
    },
  };
}

/** The file the MP4 streams into (temp/video). The previous export's file
 *  goes first — it was kept until now so its download could finish. */
async function openTempFile(): Promise<
  Result<{ dir: FileSystemDirectoryHandle; handle: FileSystemFileHandle; stream: FileSystemWritableFileStream }>
> {
  try {
    const dir = await videoTempDir();
    await clearDir(dir);
    const handle = await dir.getFileHandle(TEMP_NAME, { create: true });
    return { data: { dir, handle, stream: await handle.createWritable() } };
  } catch (err) {
    return { error: { err, msg: 'The browser’s storage would not take the video (is the disk full?).' } };
  }
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const videoExportActions = {
  /** Open the Export video dialog (the mode starts when it is off). */
  async open(): Promise<void> {
    if (!(await animationUiActions.ensureMode())) {
      return;
    }
    videoExportState.set({ open: true, settings: loadSettings(), pick: defaultPick() });
  },

  /** The one scene, or the part's Start / End. Another scene starts as all
   *  of it. */
  setPick(patch: Partial<VideoPick>): void {
    const pick = { ...videoExportState.get().pick, ...patch };
    if (patch.scene !== undefined && patch.scene !== videoExportState.get().pick.scene) {
      const scene = animationDocState.get().doc.scenes.find((s) => s.id === patch.scene);
      pick.from = 0;
      pick.to = scene ? sceneView(scene).duration : 0;
    }
    videoExportState.set({ pick });
  },

  /** The part = the Timeline's in / out range (Shift + drag on the ruler). */
  partFromRange(): void {
    const r = markedRange();
    if (!r) {
      toast.info('Mark an in / out range on the Timeline first (Shift + drag on the ruler).');
      return;
    }
    videoExportActions.set({ scenes: 'one', span: 'part' });
    videoExportState.set({ pick: { scene: currentView()?.scene.id ?? '', ...r } });
  },

  /** The part = the step at the time slider. */
  partFromStep(): void {
    const r = stepHere();
    if (!r) {
      toast.info('Put the time slider in a step first.');
      return;
    }
    videoExportActions.set({ scenes: 'one', span: 'part' });
    videoExportState.set({ pick: { scene: currentView()?.scene.id ?? '', ...r } });
  },

  close(): void {
    if (videoExportState.get().phase.kind === 'idle') {
      videoExportState.set({ open: false });
    }
  },

  set(patch: Partial<VideoExportSettings>): void {
    const settings = { ...videoExportState.get().settings, ...patch };
    videoExportState.set({ settings });
    saveSettings(settings);
  },

  /** Stop after the frame being made; nothing is saved. */
  cancel(): void {
    cancelled = true;
  },

  /** Render, encode and download the video: its stretches one after
   *  another into one file, streamed to disk as it is made. */
  async start(): Promise<void> {
    const { settings, pick, phase } = videoExportState.get();
    const r = runtimeRenderer();
    const home = currentView();
    if (phase.kind !== 'idle' || !r?.canvasEl || !home) {
      return;
    }
    const segments = videoSegments(animationDocState.get().doc.scenes, { ...settings, ...pick }, settings.holdS);
    if (segments.length === 0) {
      toast.info(nothingMessage(settings));
      return;
    }
    const plan = segments.map((seg) => ({ seg, times: videoFrameTimes({ ...seg, fps: settings.fps }) }));
    const total = plan.reduce((n, p) => n + p.times.length, 0);
    const keep = { time: liveTimeNow(), camera: captureCameraPose(r), follow: playerState.get().camera === 'follow' };
    // the MP4 writer (and Mediabunny) load with the first export, not at start-up
    const mp4 = await import('../../lib/video/mp4Writer').catch(() => null);
    if (!mp4) {
      dialogs.error('The video writer could not be loaded — reload the page and export again.');
      return;
    }
    cancelled = false;
    const session = await beginCapture(r, settings.height, settings.overlays);
    const temp = await openTempFile();
    if (temp.error || !temp.data) {
      await endCapture(session);
      dialogs.error(temp.error?.msg ?? 'Could not make a file for the video.');
      return;
    }
    const { dir, handle, stream } = temp.data;
    const opened = await mp4.openMp4Writer(stream, total, session.width, session.height, settings.fps);
    if (opened.error || !opened.data) {
      await endCapture(session);
      await clearDir(dir).catch(() => undefined);
      dialogs.error(opened.error?.msg ?? 'Could not start the video encoder.');
      return;
    }
    const writer = opened.data;
    let saved = false;
    let startedAt = performance.now();
    const tab = watchTab(writer, (hiddenMs) => {
      startedAt += hiddenMs;
    });
    try {
      let i = 0;
      for (const { seg, times } of plan) {
        if (cancelled) {
          break;
        }
        await onScene(seg.scene);
        for (const T of times) {
          if (cancelled) {
            break;
          }
          videoExportState.set({ phase: { kind: 'rendering', frame: i, total, startedAt } });
          tab.progress(i, total);
          // waiting at a pausing step's end, its card stays up
          holdStep(holdAt(seg, T));
          const frame = await grabFrame(session, T, { quality: settings.quality, overlays: settings.overlays });
          const added = await writer.add(frame, i);
          if (added.error) {
            dialogs.error(added.error.msg);
            return;
          }
          i++;
        }
      }
      if (cancelled) {
        toast.info('Video export cancelled — nothing was saved.');
        return;
      }
      videoExportState.set({ phase: { kind: 'finishing' } });
      const done = await writer.finish();
      if (done.error) {
        dialogs.error(done.error.msg);
        return;
      }
      saved = true;
      const file = await handle.getFile();
      const name = animationDocState.get().doc.name || 'animation';
      downloadBlob(`${name}.mp4`, file);
      toast.success(
        `Video saved: ${total} frames, ${session.width}×${session.height} (${writer.codec}), ${(file.size / MB).toFixed(1)} MB.`,
      );
      videoExportState.set({ open: false });
    } finally {
      if (!saved) {
        // cancelled or failed: let go of the file and drop it
        await writer.close();
        await clearDir(dir).catch(() => undefined);
      }
      holdStep(null);
      tab.stop();
      // back on the scene that was open (captured again), then its time
      await onScene(home.scene.id);
      await endCapture(session);
      playerActions.seek(keep.time);
      if (!keep.follow) {
        // the viewer had taken the camera: give its view back
        playerActions.userTookCamera();
        setCameraPose(r, keep.camera);
      }
      videoExportState.set({ phase: { kind: 'idle' } });
    }
  },
};
