// The Problems list (DESIGN.md › Animation › Evaluation): the check of the
// active scene, recomputed into problemsState when the doc, the overlay
// library or the mode's session changes — at once while it is cheap,
// debounced while it is slow — and "Go to": pick what a problem names.

import { STEP_CARD_PREFIX } from '../../lib/animation/evaluate';
import { checkScene, type Problem } from '../../lib/animation/problems';
import { overlayLibraryState } from '../overlayComponents/overlayComponents.state';
import { animationDocState } from './animationDoc.state';
import { animationUiActions } from './animationUi.actions';
import { contentRevision } from './docContent';
import { activeScene } from './docEdit';
import { objectsActions } from './objects.actions';
import { playerActions } from './player.actions';
import { playerState } from './player.state';
import { problemsState } from './problems.state';
import { objectRow } from './rows';
import { sessionInfo } from './runtime';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

/** A check slower than this is debounced by PROBLEMS_DEBOUNCE_MS. */
const SLOW_CHECK_MS = 8;
const PROBLEMS_DEBOUNCE_MS = 200;

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

/** the last check and what it was made from (compared by identity) */
let cache: { inputs: readonly unknown[]; problems: Problem[] } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastCheckMs = 0;
/** the session's unresolved map last checked against (identity) */
let lastSession: unknown = null;

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function publishProblems(): void {
  timer = null;
  const t0 = performance.now();
  const problems = currentProblems();
  lastCheckMs = performance.now() - t0;
  if (problems !== problemsState.get().problems) {
    problemsState.set({ problems });
  }
}

function scheduleProblems(): void {
  if (timer === null) {
    timer = setTimeout(publishProblems, lastCheckMs > SLOW_CHECK_MS ? PROBLEMS_DEBOUNCE_MS : 0);
  }
}

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** Every problem of the active scene (cached: each panel that lists
 *  problems asks for the same check). */
export function currentProblems(): Problem[] {
  const doc = animationDocState.get().doc;
  const scene = activeScene(doc);
  const info = sessionInfo();
  const components = overlayLibraryState.get().components;
  const inputs = [contentRevision(), components, info?.unresolved ?? null, info?.shared ?? null];
  if (cache?.inputs.every((x, i) => x === inputs[i])) {
    return cache.problems;
  }
  const problems = scene
    ? checkScene(doc, scene, {
        unresolved: info?.unresolved ?? new Map(),
        shared: info?.shared ?? [],
        libraryComponents: new Set(components.map((c) => c.id)),
      })
    : [];
  cache = { inputs, problems };
  return problems;
}

/** Pick what a problem names: the object (its items selected), the callout
 *  or the step. */
export function goToProblem(p: Problem): void {
  if (p.kind === 'unresolvedObject' || p.kind === 'sharedItems' || p.kind === 'hiddenMove') {
    animationUiActions.setCurrent(objectRow(p.object));
    animationUiActions.pick({ kind: 'none' });
    void objectsActions.selectItems(p.object);
    if (p.kind === 'hiddenMove') {
      playerActions.seek(p.t);
    }
    return;
  }
  if (p.kind === 'missingInstance' || p.kind === 'missingAnchor') {
    animationUiActions.pick({ kind: 'callout', id: p.callout, keys: [] });
    return;
  }
  if (p.instance.startsWith(STEP_CARD_PREFIX)) {
    animationUiActions.pick({ kind: 'step', id: p.instance.slice(STEP_CARD_PREFIX.length) });
    return;
  }
  const c = activeScene()?.callouts.find((x) => x.instance === p.instance);
  if (c) {
    animationUiActions.pick({ kind: 'callout', id: c.id, keys: [] });
  }
}

/** Keep problemsState current (startup, once): doc and library edits, and
 *  the mode's session (its unresolved / shared items) entering or leaving. */
export function installProblems(): () => void {
  const offs = [
    animationDocState.subscribe(scheduleProblems),
    overlayLibraryState.subscribe(scheduleProblems),
    playerState.subscribe(() => {
      const session = sessionInfo()?.unresolved ?? null;
      if (session !== lastSession) {
        lastSession = session;
        scheduleProblems();
      }
    }),
  ];
  scheduleProblems();
  return () => {
    for (const off of offs) {
      off();
    }
  };
}

/** Go to the active scene's first problem; false when there is none. */
export function goToFirstProblem(): boolean {
  const first = currentProblems()[0];
  if (first) {
    goToProblem(first);
  }
  return first !== undefined;
}
