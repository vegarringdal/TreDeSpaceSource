import { createStore } from '@treDeSpaceUI/lib/createStore';

export type VideoHeight = 720 | 1080 | 1440;
export type VideoFps = 24 | 30 | 60;
/** draft = one render per frame (fast); best = every frame converged like a
 *  screenshot (smooth edges, slower) */
export type VideoQuality = 'draft' | 'best';
/** which scenes: every scene one after another, or one scene */
export type VideoScenes = 'all' | 'one';
/** of one scene: all of it, or the part from Start to End */
export type VideoSpan = 'whole' | 'part';

export interface VideoExportSettings {
  height: VideoHeight;
  fps: VideoFps;
  quality: VideoQuality;
  scenes: VideoScenes;
  span: VideoSpan;
  overlays: boolean;
  /** seconds the video waits at the end of a step that pauses there */
  holdS: number;
}

/** What this export takes from the open animation (not remembered: it
 *  belongs to the animation) — the one scene, and the part's Start / End
 *  in its seconds. */
export interface VideoPick {
  scene: string;
  from: number;
  to: number;
}

export type VideoExportPhase =
  | { kind: 'idle' }
  | { kind: 'rendering'; frame: number; total: number; startedAt: number }
  | { kind: 'finishing' };

/** Video export (DESIGN.md › Animation › Capture): the dialog, its settings
 *  (persisted by the actions) and the running export's progress. */
export interface VideoExportState {
  open: boolean;
  settings: VideoExportSettings;
  pick: VideoPick;
  phase: VideoExportPhase;
}

export const DEFAULT_VIDEO_SETTINGS: VideoExportSettings = {
  height: 1080,
  fps: 30,
  quality: 'draft',
  scenes: 'one',
  span: 'whole',
  overlays: true,
  holdS: 1,
};

export const videoExportState = createStore<VideoExportState>({
  open: false,
  settings: DEFAULT_VIDEO_SETTINGS,
  pick: { scene: '', from: 0, to: 0 },
  phase: { kind: 'idle' },
});
