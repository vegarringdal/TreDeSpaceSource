import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { Problem } from '../../lib/animation/problems';

/** The active scene's Problems list (DESIGN.md › Animation › Evaluation), kept
 *  current by problems.ts — off the render path, so a key drag on a big
 *  animation does not run the check in every panel render. */
export interface ProblemsState {
  problems: Problem[];
}

export const problemsState = createStore<ProblemsState>({ problems: [] });
