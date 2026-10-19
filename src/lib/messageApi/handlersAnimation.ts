// Animation commands (DESIGN.md › Animation › Files and host API, EVENTS.md → animation.*):
// load / read the doc, enter a mode, present it, drive the player, list
// steps, the host's bookmark button. Events (stateChanged, stepStarted /
// stepEnded, ended) come from the runtime, `animation.bookmark` from the
// button.

import { animationDocActions } from '../../state/animation/animationDoc.actions';
import { animationDocState } from '../../state/animation/animationDoc.state';
import { animationUiActions } from '../../state/animation/animationUi.actions';
import { hostBookmarkActions } from '../../state/animation/hostBookmark.actions';
import { playerActions } from '../../state/animation/player.actions';
import { playerState } from '../../state/animation/player.state';
import { presentActions } from '../../state/animation/present.actions';
import { currentView, liveTimeNow } from '../../state/animation/runtime';
import { validateAnimationDoc } from '../animation/io';
import type { PlayScope } from '../animation/playhead';
import { sceneView } from '../animation/scene';
import { ApiError, type ApiHandler, isRecord } from './protocol';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function requireOn(): void {
  if (playerState.get().status === 'off') {
    throw new ApiError('not-ready', 'animation mode is off — send animation.setMode first');
  }
}

function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ApiError('bad-payload', `${name} must be a finite number`);
  }
  return v;
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) {
    throw new ApiError('bad-payload', `${name} must be a non-empty string`);
  }
  return v;
}

function parseScope(v: unknown): PlayScope | undefined {
  if (v === undefined) {
    return undefined;
  }
  if (!isRecord(v)) {
    throw new ApiError('bad-payload', 'scope must be an object');
  }
  if (v.kind === 'all') {
    return { kind: 'all' };
  }
  if (v.kind === 'range') {
    return { kind: 'range', from: num(v.from, 'scope.from'), to: num(v.to, 'scope.to') };
  }
  if (v.kind === 'step') {
    return { kind: 'step', step: requireStep(str(v.step, 'scope.step')) };
  }
  throw new ApiError('bad-payload', "scope.kind must be 'all', 'range' or 'step'");
}

/** Check a doc (and a scene it should open on) before anything changes: a
 *  bad doc is `bad-payload`, a scene it lacks `not-found`. */
function checkDoc(doc: unknown, scene?: unknown): void {
  if (!isRecord(doc)) {
    throw new ApiError('bad-payload', 'doc must be an animation document object');
  }
  const r = validateAnimationDoc(doc);
  if (!r.doc) {
    throw new ApiError('bad-payload', r.error ?? 'not an animation document');
  }
  if (typeof scene === 'string' && !r.doc.scenes.some((s) => s.id === scene)) {
    throw new ApiError('not-found', `no scene "${scene}"`);
  }
}

/** Load a doc the way `animation.load` does (mode left first); it is
 *  checked first, so a bad doc changes nothing. */
async function loadDoc(doc: unknown): Promise<Awaited<ReturnType<typeof animationDocActions.loadFromValue>>> {
  checkDoc(doc);
  if (playerState.get().status !== 'off') {
    await animationUiActions.exitMode();
  }
  const report = await animationDocActions.loadFromValue(doc);
  if (!report.ok) {
    throw new ApiError('bad-payload', report.errors.join('; '));
  }
  return report;
}

/** Make scene `id` the active one (`not-found` when the doc has none). */
function switchScene(id: unknown): void {
  if (typeof id !== 'string') {
    return;
  }
  if (!animationDocState.get().doc.scenes.some((s) => s.id === id)) {
    throw new ApiError('not-found', `no scene "${id}"`);
  }
  playerActions.switchScene(id);
}

function requireStep(id: string): string {
  if (!currentView()?.steps.some((s) => s.id === id)) {
    throw new ApiError('not-found', `no step "${id}"`);
  }
  return id;
}

// -----------------------------------------------------------------------------
// handlers
// -----------------------------------------------------------------------------

export const animationHandlers: Record<string, ApiHandler> = {
  'animation.load': ({ p }) => loadDoc(p.doc),

  'animation.get': () => ({ doc: animationDocActions.docForSave() }),

  'animation.setMode': async ({ p }) => {
    const mode = p.mode;
    if (mode !== 'off' && mode !== 'playback' && mode !== 'author') {
      throw new ApiError('bad-payload', "mode must be 'off', 'playback' or 'author'");
    }
    switchScene(p.scene);
    if (mode === 'off') {
      // presenting: the user's own layout comes back too
      if (presentActions.isPresenting()) {
        await presentActions.close({ leave: true });
      } else {
        await animationUiActions.exitMode();
      }
      return { ok: true };
    }
    const ok =
      mode === 'playback' ? await animationUiActions.enterPlayback() : await animationUiActions.enterAuthoring();
    if (!ok) {
      throw new ApiError('not-ready', 'could not enter animation mode (no scene, or no renderer)');
    }
    return { ok: true };
  },

  'animation.present': async ({ p }) => {
    if (p.doc === undefined) {
      switchScene(p.scene);
    } else {
      checkDoc(p.doc, p.scene);
    }
    // presenting another doc over a presentation keeps what the first replaced
    const from = presentActions.suspend();
    const loaded = p.doc === undefined ? null : await loadDoc(p.doc);
    if (loaded) {
      switchScene(p.scene);
    }
    if (!(await presentActions.enter({ play: p.play === true, ribbon: p.ribbon !== false, from }))) {
      throw new ApiError('not-ready', 'could not enter animation mode (no scene, or no renderer)');
    }
    return { ok: true, loaded };
  },

  'animation.setBookmarkButton': ({ p }) => {
    if (p.button === null) {
      hostBookmarkActions.setButton(null);
      return { shown: false };
    }
    if (!isRecord(p.button) || typeof p.button.label !== 'string' || !p.button.label.trim()) {
      throw new ApiError('bad-payload', 'button must be null or { label, tooltip? } with a non-empty label');
    }
    hostBookmarkActions.setButton({
      label: p.button.label.trim(),
      tooltip: typeof p.button.tooltip === 'string' ? p.button.tooltip : '',
    });
    return { shown: true };
  },

  'animation.play': ({ p }) => {
    requireOn();
    // no scope = the whole scene (not the last step or range played)
    playerActions.play(parseScope(p.scope) ?? { kind: 'all' });
    return { ok: true };
  },

  'animation.pause': () => {
    requireOn();
    playerActions.pause();
    return { ok: true };
  },

  'animation.continue': () => {
    requireOn();
    playerActions.continue();
    return { ok: true };
  },

  'animation.seek': ({ p }) => {
    requireOn();
    playerActions.seek(Math.max(0, num(p.time, 'time')));
    return { ok: true };
  },

  'animation.listScenes': () => ({
    active: currentView()?.scene.id ?? null,
    scenes: animationDocState.get().doc.scenes.map((s) => ({
      id: s.id,
      name: s.name,
      duration: sceneView(s).duration,
      steps: s.steps.length,
      objects: s.objects.length,
    })),
  }),

  'animation.setScene': ({ p }) => {
    const id = str(p.id, 'id');
    if (!animationDocState.get().doc.scenes.some((s) => s.id === id)) {
      throw new ApiError('not-found', `no scene "${id}"`);
    }
    playerActions.switchScene(id);
    return { ok: true, scene: id };
  },

  'animation.listSteps': () => ({
    steps: (currentView()?.steps ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      text: s.text,
      start: s.start,
      end: s.end,
      pauseAtEnd: s.pauseAtEnd,
    })),
  }),

  'animation.playStep': ({ p }) => {
    requireOn();
    playerActions.playStep(requireStep(str(p.id, 'id')));
    return { ok: true };
  },

  'animation.gotoStep': ({ p }) => {
    requireOn();
    playerActions.gotoStep(requireStep(str(p.id, 'id')));
    return { ok: true };
  },

  'animation.returnCamera': () => {
    requireOn();
    playerActions.returnCamera();
    return { ok: true };
  },

  'animation.getState': () => {
    const s = playerState.get();
    const v = currentView();
    return {
      status: s.status,
      mode: s.mode,
      scene: v?.scene.id ?? null,
      time: s.status === 'off' ? s.time : liveTimeNow(),
      duration: v?.duration ?? 0,
      step: s.step,
      camera: s.camera,
      speed: s.speed,
      loop: v?.scene.loop ?? false,
      pingPong: v?.scene.pingPong ?? false,
    };
  },
};
