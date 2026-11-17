import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { PlayScope } from '../../lib/animation/playhead';
import type { AnimCamera } from '../../lib/animation/types';

/** off = animation mode not entered; waiting = stopped at the end of a step
 *  that pauses there (Continue goes on). */
export type PlayerStatus = 'off' | 'stopped' | 'playing' | 'paused' | 'waiting';

/** Runtime player state (DESIGN.md › Animation › Player). The precise
 *  playhead lives in the runtime; `time` here is refreshed at a UI rate
 *  while playing and exactly on pause / seek. The speed persists via
 *  player.actions.ts. */
export interface PlayerState {
  status: PlayerStatus;
  /** playing back only (presenting, the host) or authoring */
  mode: 'off' | 'playback' | 'author';
  time: number;
  /** what Play plays */
  scope: PlayScope;
  /** 1 = forwards; -1 = on the way back (ping-pong) */
  direction: 1 | -1;
  /** the step under the time slider */
  step: string | null;
  /** follow = the view follows the camera row; free = the user's view */
  camera: 'follow' | 'free';
  /** the user switched Camera keys off: Play and Continue leave the view
   *  alone until it is switched on again (a mere view move does not set it) */
  cameraOff: boolean;
  /** the scene has camera keys to follow */
  canFollow: boolean;
  pausedCamera: AnimCamera | null;
  speed: number;
  /** 2D overlays drawn at all (ribbon View → Overlays) */
  showOverlays: boolean;
  /** band slots in use (the slot meter) */
  slotsUsed: number;
}

export const playerState = createStore<PlayerState>({
  status: 'off',
  mode: 'off',
  time: 0,
  scope: { kind: 'all' },
  direction: 1,
  step: null,
  camera: 'follow',
  cameraOff: false,
  canFollow: false,
  pausedCamera: null,
  speed: 1,
  showOverlays: true,
  slotsUsed: 0,
});
