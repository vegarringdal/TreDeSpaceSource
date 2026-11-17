// Player actions (DESIGN.md › Animation › Player): every way the viewer
// controls playback — the Timeline's transport, the floating play bar, the
// ribbon, hotkeys and the SDK all come through here. The precise playhead
// and the band live in runtime.ts; this module keeps playerState honest and
// owns the camera rules (follow / free / return — the view is never taken
// back unasked).

import { toast } from '@treDeSpaceUI/widgets';
import { type PlayScope, scopeRange } from '../../lib/animation/playhead';
import { neighbourStep } from '../../lib/animation/scene';
import { storageKey } from '../../lib/storageKeys';
import { animationDocActions } from './animationDoc.actions';
import { animationDocState } from './animationDoc.state';
import { type PlayerState, playerState } from './player.state';
import {
  currentFrame,
  currentView,
  enterPending,
  enterSession,
  exitSession,
  liveTimeNow,
  requestApply,
  requestBandSync,
  runtimeRenderer,
  sessionActive,
  setLiveTime,
  setUserInputHandler,
} from './runtime';
import { cancelReturnBlend, captureCameraPose, startReturnBlend } from './runtimeCamera';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

type Prefs = Pick<PlayerState, 'speed'>;

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const PREFS_KEY = storageKey('animationPlayer');
const ALL: PlayScope = { kind: 'all' };

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function loadPrefs(): Partial<Prefs> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    const speed = typeof raw === 'object' && raw !== null && 'speed' in raw ? raw.speed : undefined;
    return typeof speed === 'number' && speed > 0 ? { speed } : {};
  } catch {
    return {};
  }
}

function savePrefs(): void {
  const prefs: Prefs = { speed: playerState.get().speed };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage blocked — preferences live for the session
  }
}

function handleUserInput(): void {
  const p = playerState.get();
  if (p.status === 'off' || p.camera === 'free') {
    return;
  }
  playerActions.userTookCamera();
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const playerActions = {
  /** Enter animation mode on the active scene (playback = no editing). */
  async enter(mode: 'playback' | 'author'): Promise<boolean> {
    if (animationDocState.get().doc.scenes.length === 0) {
      toast.warning('This animation has no scene to play.');
      return false;
    }
    playerState.set({ ...loadPrefs(), mode });
    const res = await enterSession();
    if (res.superseded) {
      // left (or entered again) while the worker captured
      return false;
    }
    if (res.error) {
      toast.error(`Could not enter animation mode: ${res.error}`);
      playerState.set({ status: 'off', mode: 'off' });
      return false;
    }
    if (res.bandFull) {
      toast.warning('Too many objects move on their own — some will not move (the slot band is full).');
    }
    setUserInputHandler(handleUserInput);
    playerState.set({ status: 'stopped', camera: 'follow', cameraOff: false, scope: ALL, direction: 1 });
    setLiveTime(Math.min(liveTimeNow(), currentView()?.duration ?? 0));
    return true;
  },

  /** Leave animation mode; the scene is restored exactly. */
  async exit(): Promise<void> {
    if (playerState.get().status === 'off' && !sessionActive() && !enterPending()) {
      return;
    }
    setUserInputHandler(null);
    playerState.set({ status: 'off', mode: 'off', step: null });
    await exitSession();
  },

  /** Work on / play another scene of the doc (the runtime captures its
   *  objects; the time slider goes back to the start). */
  switchScene(id: string): void {
    if (!animationDocState.get().doc.scenes.some((s) => s.id === id)) {
      return;
    }
    animationDocActions.setActiveScene(id);
    if (playerState.get().status === 'off') {
      return;
    }
    playerState.set({ status: 'stopped', scope: ALL, direction: 1 });
    setLiveTime(0);
  },

  /** Cycle through the doc's scenes. */
  nextScene(): void {
    const s = animationDocState.get();
    const i = s.doc.scenes.findIndex((x) => x.id === s.activeScene);
    const next = s.doc.scenes[(i + 1) % Math.max(1, s.doc.scenes.length)];
    if (next) {
      playerActions.switchScene(next.id);
    }
  },

  /** Switch playback-only ↔ authoring without leaving the mode. */
  setMode(mode: 'playback' | 'author'): void {
    playerState.set({ mode });
  },

  play(scope?: PlayScope): void {
    const p = playerState.get();
    if (p.status === 'off') {
      return;
    }
    // Play from a stop watches the animation: its camera takes over again
    // (moving the view to set camera keys had made it free) — unless the
    // user switched Camera keys off
    if (p.status === 'stopped' && p.camera === 'free' && p.canFollow && !p.cameraOff) {
      playerActions.returnCamera();
    }
    const v = currentView();
    const next = scope ?? p.scope;
    if (v) {
      const [s, e] = scopeRange(next, v);
      const t = liveTimeNow();
      // play from the scope start when outside it or parked at its end
      if (t < s - 1e-6 || t >= e - 1e-6) {
        setLiveTime(s);
      }
    }
    playerState.set({ status: 'playing', scope: next, direction: 1 });
  },

  pause(): void {
    if (playerState.get().status !== 'playing') {
      return;
    }
    const r = runtimeRenderer();
    playerState.set({ status: 'paused', pausedCamera: r ? captureCameraPose(r) : null, time: liveTimeNow() });
    requestBandSync();
  },

  togglePlay(): void {
    const s = playerState.get().status;
    if (s === 'playing') {
      playerActions.pause();
    } else if (s === 'paused' || s === 'waiting') {
      playerActions.continue();
    } else if (s === 'stopped') {
      playerActions.play();
    }
  },

  /** Resume from the exact paused time; the view follows the camera row
   *  again when it has keys. */
  continue(): void {
    const p = playerState.get();
    if (p.status !== 'paused' && p.status !== 'waiting') {
      return;
    }
    if (p.camera === 'free' && p.canFollow && !p.cameraOff) {
      playerActions.returnCamera();
    }
    playerState.set({ status: 'playing' });
  },

  /** Stop and go to the start of what plays. */
  stop(): void {
    const p = playerState.get();
    if (p.status === 'off') {
      return;
    }
    const v = currentView();
    const [s] = v ? scopeRange(p.scope, v) : [0];
    playerState.set({ status: 'stopped', direction: 1 });
    setLiveTime(s);
    requestBandSync();
  },

  seek(time: number): void {
    if (playerState.get().status === 'off') {
      return;
    }
    setLiveTime(time);
    if (playerState.get().status !== 'playing') {
      requestBandSync();
    }
  },

  /** Play one step and stop at its end. */
  playStep(id: string): void {
    const s = currentView()?.steps.find((x) => x.id === id);
    if (!s) {
      return;
    }
    setLiveTime(s.start);
    playerActions.play({ kind: 'step', step: id });
  },

  /** Jump to a step's start, paused there. */
  gotoStep(id: string): void {
    const s = currentView()?.steps.find((x) => x.id === id);
    if (!s || playerState.get().status === 'off') {
      return;
    }
    playerState.set({ status: 'paused', scope: ALL, direction: 1 });
    setLiveTime(s.start);
    requestBandSync();
  },

  nextStep(): void {
    const v = currentView();
    const s = v ? neighbourStep(v, liveTimeNow(), 1) : null;
    if (s) {
      playerActions.gotoStep(s.id);
    }
  },

  prevStep(): void {
    const v = currentView();
    const s = v ? neighbourStep(v, liveTimeNow(), -1) : null;
    if (s) {
      playerActions.gotoStep(s.id);
    }
  },

  /** Play the step under the time slider again. */
  replayStep(): void {
    const p = playerState.get();
    const id = p.scope.kind === 'step' ? p.scope.step : p.step;
    if (id) {
      playerActions.playStep(id);
    }
  },

  /** Back to the animation's view: a smoothstep blend onto a moving camera,
   *  an animated move onto a still one. */
  returnCamera(): void {
    const r = runtimeRenderer();
    const view = currentFrame()?.camera;
    if (!r || !view) {
      return;
    }
    // a smoothstep blend from the user's view onto the camera row — onto
    // one key as well (a fly would be cut short by the next frame's pose)
    startReturnBlend(r, performance.now());
    playerState.set({ camera: 'follow', cameraOff: false });
    requestApply();
  },

  /** Follow the camera row at once (no Return blend) — a camera key, video
   *  export. */
  followCamera(): void {
    cancelReturnBlend();
    playerState.set({ camera: 'follow', cameraOff: false });
    requestApply();
  },

  /** Camera keys (View ribbon, play bar): follow the camera keys, or orbit
   *  freely — switched off it stays off through Play and Continue (and a
   *  restart) until switched on again, R, or a camera key. */
  toggleCameraFollow(): void {
    if (!playerState.get().canFollow) {
      return;
    }
    if (playerState.get().camera === 'free') {
      playerActions.returnCamera();
      return;
    }
    playerActions.userTookCamera();
    playerState.set({ cameraOff: true });
  },

  /** Any user camera input while following → free. */
  userTookCamera(): void {
    cancelReturnBlend();
    playerState.set({ camera: 'free' });
  },

  setSpeed(speed: number): void {
    playerState.set({ speed });
    savePrefs();
  },

  toggleOverlays(): void {
    playerState.set({ showOverlays: !playerState.get().showOverlays });
  },
};
