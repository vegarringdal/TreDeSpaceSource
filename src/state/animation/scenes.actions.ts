// Scenes (DESIGN.md › Animation › Data model): the animations of one file,
// picked in the Timeline's Scene ▾ (and the play bar's). New and rename (named
// in a prompt), delete, and the scene's own
// playback settings — loop, ping-pong, a pinned end, the step card. Every
// edit goes through commit (undoable).

import { toast } from '@treDeSpaceUI/widgets';
import { dialogs } from '../../components/dialogs/dialogs.actions';
import { defaultStepCard, emptyScene } from '../../lib/animation/io';
import type { Scene } from '../../lib/animation/types';
import { animationDocActions } from './animationDoc.actions';
import { animationDocState } from './animationDoc.state';
import { activeScene, mapActiveScene } from './docEdit';
import { playerActions } from './player.actions';
import { liveTimeNow } from './runtime';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function patchActive(patch: Partial<Omit<Scene, 'id'>>, coalesce?: string): void {
  animationDocActions.commit((d) => mapActiveScene(d, (s) => ({ ...s, ...patch })), coalesce);
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const scenesActions = {
  /** A new empty scene, made the active one. */
  newScene(name?: string): void {
    const s = emptyScene(name || `Scene ${animationDocState.get().doc.scenes.length + 1}`);
    animationDocActions.commit((d) => ({ ...d, scenes: [...d.scenes, s] }));
    playerActions.switchScene(s.id);
  },

  rename(name: string): void {
    patchActive({ name }, 'scene-name');
  },

  /** New scene… — named in a prompt first (cancel = none). */
  async newSceneNamed(): Promise<void> {
    const fallback = `Scene ${animationDocState.get().doc.scenes.length + 1}`;
    const name = await dialogs.prompt('What is the new scene called?', {
      title: 'New scene',
      defaultValue: fallback,
      okLabel: 'Create',
    });
    if (name !== null) {
      scenesActions.newScene(name.trim() || fallback);
    }
  },

  /** Rename this scene… — the active scene's name in a prompt. */
  async renamePrompt(): Promise<void> {
    const current = activeScene()?.name ?? '';
    const name = await dialogs.prompt('What is this scene called?', {
      title: 'Rename scene',
      defaultValue: current,
      okLabel: 'Rename',
    });
    const next = name?.trim();
    if (next && next !== current) {
      scenesActions.rename(next);
    }
  },

  /** Delete the active scene (undoable) with the overlays only it shows;
   *  the next one becomes active. The last one stays. */
  deleteScene(): void {
    const st = animationDocState.get();
    const i = st.doc.scenes.findIndex((x) => x.id === st.activeScene);
    const s = st.doc.scenes[i];
    const next = st.doc.scenes[i + 1] ?? st.doc.scenes[i - 1];
    if (!s || !next) {
      toast.info('An animation keeps at least one scene.');
      return;
    }
    playerActions.switchScene(next.id);
    animationDocActions.commit((d) => {
      const rest = d.scenes.filter((x) => x.id !== s.id);
      const shownElsewhere = new Set(rest.flatMap((x) => x.callouts.map((c) => c.instance)));
      const orphans = new Set(s.callouts.map((c) => c.instance).filter((id) => !shownElsewhere.has(id)));
      return { ...d, scenes: rest, overlayInstances: d.overlayInstances.filter((o) => !orphans.has(o.id)) };
    });
    toast.info(`Deleted "${s.name || 'Scene'}" — Undo brings it back.`);
  },

  toggleLoop(): void {
    const s = activeScene();
    if (s) {
      patchActive({ loop: !s.loop });
    }
  },

  togglePingPong(): void {
    const s = activeScene();
    if (s) {
      patchActive({ pingPong: !s.pingPong });
    }
  },

  /** Pin the end (null = it follows the last key, step or callout). */
  setEnd(end: number | null): void {
    animationDocActions.commit((d) =>
      mapActiveScene(d, (s) => {
        if (end === null) {
          const { end: _pinned, ...rest } = s;
          return rest;
        }
        return { ...s, end: Math.max(0, end) };
      }),
    );
  },

  /** Pin the end at the time slider. */
  pinEndHere(): void {
    scenesActions.setEnd(liveTimeNow());
  },

  /** The card every step shows unless it has its own (null = none). */
  setStepCard(card: Scene['stepCard']): void {
    patchActive({ stepCard: card });
  },

  /** Steps show the built-in step card — or no card. */
  toggleStepCards(): void {
    const s = activeScene();
    if (s) {
      patchActive({ stepCard: s.stepCard ? null : defaultStepCard() });
    }
  },

  /** Attached labels flip / clamp to stay inside the view. */
  toggleOverlaysOnScreen(): void {
    const s = activeScene();
    if (!s) {
      return;
    }
    animationDocActions.commit((d) =>
      mapActiveScene(d, (x) => {
        if (x.keepOverlaysOnScreen === false) {
          const { keepOverlaysOnScreen: _off, ...rest } = x;
          return rest;
        }
        return { ...x, keepOverlaysOnScreen: false };
      }),
    );
  },
};
