// One-shot animation wiring at app boot: the overlay library from OPFS, the
// "recover unsaved animation?" draft check, the Problems list and the
// Timeline's saved name column width.

import { overlayLibraryActions } from '../overlayComponents/overlayComponents.actions';
import { animationDocActions } from './animationDoc.actions';
import { installStateEvents } from './animationEvents';
import { animationUiActions } from './animationUi.actions';
import { installProblems } from './problems';

/** Called once from useAppStartup. */
export function initAnimation(): void {
  void overlayLibraryActions.load();
  void animationDocActions.checkDraft();
  installProblems();
  installStateEvents();
  animationUiActions.loadTimelinePrefs();
}
