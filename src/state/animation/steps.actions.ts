// Steps (DESIGN.md › Animation › Authoring): named spans on the Steps row,
// with text and a card, that can pause playback at their end. They never
// overlap — a new one fills the time slider up to the next step (or a few
// seconds), and edges stop at their neighbours. Every edit goes through
// commit (undoable).

import { toast } from '@treDeSpaceUI/widgets';
import { newId } from '../../lib/animation/io';
import type { Scene, Step, StepCard } from '../../lib/animation/types';
import { animationDocActions } from './animationDoc.actions';
import { animationUiState } from './animationUi.state';
import { activeScene, mapActiveScene } from './docEdit';
import { liveTimeNow } from './runtime';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** Length of a new step when nothing follows it (s). */
export const NEW_STEP_S = 5;
/** Shortest step (s). */
const MIN_STEP_S = 0.1;
const EPS = 1e-6;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function sorted(steps: readonly Step[]): Step[] {
  return [...steps].sort((a, b) => a.start - b.start);
}

/** The room a step may take: from the end of the step before to the start
 *  of the one after. */
function roomFor(s: Scene, id: string): { lo: number; hi: number } {
  const list = sorted(s.steps);
  const i = list.findIndex((x) => x.id === id);
  return { lo: list[i - 1]?.end ?? 0, hi: list[i + 1]?.start ?? Infinity };
}

function editSteps(fn: (steps: readonly Step[], s: Scene) => Step[], coalesce?: string): void {
  animationDocActions.commit((d) => mapActiveScene(d, (s) => ({ ...s, steps: sorted(fn(s.steps, s)) })), coalesce);
}

function mapStep(id: string, fn: (st: Step, s: Scene) => Step, coalesce?: string): void {
  editSteps((steps, s) => steps.map((x) => (x.id === id ? fn(x, s) : x)), coalesce);
}

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const stepsActions = {
  /** A step from the time slider to the next step (or NEW_STEP_S), picked. */
  addAtSlider(): string | null {
    const s = activeScene();
    if (!s) {
      return null;
    }
    const T = liveTimeNow();
    if (s.steps.some((x) => T >= x.start - EPS && T < x.end - EPS)) {
      toast.info('A step already runs here — move the time slider past its end, or drag its edges.');
      return null;
    }
    const next = sorted(s.steps).find((x) => x.start > T + EPS);
    if (next && next.start - T < MIN_STEP_S) {
      toast.info('No room for a step here — the next step starts right after the time slider.');
      return null;
    }
    const end = Math.min(T + NEW_STEP_S, next?.start ?? Infinity);
    const step: Step = {
      id: newId('st'),
      name: `Step ${s.steps.length + 1}`,
      text: '',
      start: T,
      end: Math.max(T + MIN_STEP_S, end),
      pauseAtEnd: false,
    };
    editSteps((steps) => [...steps, step]);
    animationUiState.set({ picked: { kind: 'step', id: step.id }, current: '@steps' });
    return step.id;
  },

  update(id: string, patch: Partial<Omit<Step, 'id' | 'start' | 'end'>>, coalesce?: string): void {
    mapStep(id, (st) => ({ ...st, ...patch }), coalesce);
  },

  /** A step's card: its own (a design and values), none (null) or the
   *  scene's (undefined). */
  setCard(id: string, card: StepCard | null | undefined, coalesce?: string): void {
    mapStep(
      id,
      (st) => {
        if (card === undefined) {
          const { card: _own, ...rest } = st;
          return rest;
        }
        return { ...st, card };
      },
      coalesce,
    );
  },

  /** Move a step's start / end, kept inside its room and at least
   *  MIN_STEP_S long. */
  setSpan(id: string, start: number, end: number, coalesce?: string): void {
    mapStep(
      id,
      (st, s) => {
        const room = roomFor(s, id);
        const a = Math.max(room.lo, Math.min(start, end - MIN_STEP_S));
        const b = Math.min(room.hi, Math.max(end, a + MIN_STEP_S));
        return { ...st, start: a, end: b };
      },
      coalesce,
    );
  },

  /** Move a whole step by dt, inside its room. */
  move(id: string, dt: number, coalesce?: string): void {
    mapStep(
      id,
      (st, s) => {
        const room = roomFor(s, id);
        const len = st.end - st.start;
        const a = Math.max(room.lo, Math.min(st.start + dt, room.hi - len));
        return { ...st, start: a, end: a + len };
      },
      coalesce,
    );
  },

  togglePause(id: string): void {
    mapStep(id, (st) => ({ ...st, pauseAtEnd: !st.pauseAtEnd }));
  },

  remove(id: string): void {
    editSteps((steps) => steps.filter((x) => x.id !== id));
    const p = animationUiState.get().picked;
    if (p.kind === 'step' && p.id === id) {
      animationUiState.set({ picked: { kind: 'none' } });
    }
  },

  /** The step running at the time slider, else null. */
  atSlider(): Step | null {
    const T = liveTimeNow();
    return activeScene()?.steps.find((x) => T >= x.start - EPS && T <= x.end + EPS) ?? null;
  },
};
