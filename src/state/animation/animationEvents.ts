// postMessage events of the animation player (DESIGN.md › Animation › Files and host API,
// EVENTS.md → Events). Each type is emitted with a LITERAL name — the API
// parity test reads them from the source.

import { emitApiEvent } from '../../lib/messageApi/transport';
import { animationDocState } from './animationDoc.state';
import { activeScene } from './docEdit';
import { playerState } from './player.state';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export type AnimationEventType =
  | 'animation.stateChanged'
  | 'animation.stepStarted'
  | 'animation.stepEnded'
  | 'animation.ended';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** stateChanged is throttled: hosts mirror it in their own UI. */
const STATE_THROTTLE_MS = 250;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

let lastState = 0;
let lastStatus = '';
let lastCamera = '';
let lastScene = '';
/** The newest state held back by the throttle, sent when it runs out. */
let trailing: Record<string, unknown> | null = null;
let trailingTimer = 0;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function sendState(payload: Record<string, unknown>): void {
  clearTimeout(trailingTimer);
  trailingTimer = 0;
  trailing = null;
  lastState = performance.now();
  lastStatus = String(payload.status ?? '');
  lastCamera = String(payload.camera ?? '');
  lastScene = String(payload.scene ?? '');
  emitApiEvent('animation.stateChanged', payload);
}

function sendTrailing(): void {
  trailingTimer = 0;
  if (trailing) {
    sendState(trailing);
  }
}

// -----------------------------------------------------------------------------
// emit
// -----------------------------------------------------------------------------

/** Post one animation event to every subscribed host. */
export function emitAnimationEvent(type: AnimationEventType, payload: Record<string, unknown>): void {
  switch (type) {
    case 'animation.stateChanged': {
      // status and camera changes always go out; time updates at most every
      // 250 ms — and the last of a burst still goes out when it runs out
      const now = performance.now();
      const same =
        String(payload.status ?? '') === lastStatus &&
        String(payload.camera ?? '') === lastCamera &&
        String(payload.scene ?? '') === lastScene;
      if (same && now - lastState < STATE_THROTTLE_MS) {
        trailing = payload;
        if (!trailingTimer) {
          trailingTimer = window.setTimeout(sendTrailing, STATE_THROTTLE_MS - (now - lastState));
        }
        return;
      }
      sendState(payload);
      return;
    }
    case 'animation.stepStarted':
      emitApiEvent('animation.stepStarted', payload);
      return;
    case 'animation.stepEnded':
      emitApiEvent('animation.stepEnded', payload);
      return;
    case 'animation.ended':
      emitApiEvent('animation.ended', payload);
      return;
  }
}

/** The player's state as `animation.stateChanged` carries it. */
export function stateEventPayload(time: number): Record<string, unknown> {
  const p = playerState.get();
  return { status: p.status, time, step: p.step, camera: p.camera, scene: activeScene()?.id ?? null };
}

/** Every change of the player's status, its camera or the active scene
 *  reaches hosts at once — pause, stop, leaving the mode ('off'), the user
 *  taking the camera or picking another scene — not only those that come
 *  with a time update. Installed once at startup. */
export function installStateEvents(): () => void {
  const sig = () => {
    const p = playerState.get();
    return `${p.status}|${p.camera}|${activeScene()?.id ?? ''}`;
  };
  let last = sig();
  const onChange = () => {
    const now = sig();
    if (now === last) {
      return;
    }
    last = now;
    emitAnimationEvent('animation.stateChanged', stateEventPayload(playerState.get().time));
  };
  const offs = [playerState.subscribe(onChange), animationDocState.subscribe(onChange)];
  return () => {
    for (const off of offs) {
      off();
    }
  };
}
