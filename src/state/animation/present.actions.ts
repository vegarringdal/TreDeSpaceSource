// Presenting (DESIGN.md › Animation › Player): playback in the Present
// workspace — the 3D view alone with the floating play bar. The layout and
// the mode before are kept, so the play bar's Close comes back to exactly
// the panels, ribbon and mode the user (or host) had.

import { presentWorkspace } from '../../lib/appLayout';
import { layoutsActions } from '../layouts.state';
import { animationUiActions } from './animationUi.actions';
import { animationUiState } from './animationUi.state';
import { playerActions } from './player.actions';

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

export type Before = Readonly<{
  layout: ReturnType<typeof layoutsActions.snapshot>;
  mode: 'off' | 'author' | 'playback';
}>;

/** What presenting replaced, while presenting (null otherwise). */
let before: Before | null = null;

// Leaving playback any other way (Animate, the mode turned off) ends the
// presentation: what it replaced is forgotten, never restored later.
animationUiState.subscribe(() => {
  if (before && animationUiState.get().mode.kind !== 'playback') {
    before = null;
  }
});

// -----------------------------------------------------------------------------
// actions
// -----------------------------------------------------------------------------

export const presentActions = {
  /** Present the active scene: playback in the Present workspace (the
   *  ribbon collapsed with `ribbon: false`), playing with `play: true`.
   *  Pressed again while presenting it keeps what it came from; `from` is
   *  what an earlier presentation replaced (the host presenting another
   *  doc over one — see suspend). */
  async enter(opts: { play?: boolean; ribbon?: boolean; from?: Before | null } = {}): Promise<boolean> {
    const mode = animationUiState.get().mode.kind;
    const from: Before = opts.from ?? before ?? { layout: layoutsActions.snapshot(), mode };
    if (!(await animationUiActions.enterPlayback())) {
      return false;
    }
    before = from;
    layoutsActions.applyWorkspace(presentWorkspace('ribbonAnimation'), 'ribbonAnimation', opts.ribbon !== false);
    if (opts.play) {
      playerActions.play();
    }
    return true;
  },

  /** Is the play bar's Close going back to a layout from before? */
  isPresenting(): boolean {
    return before !== null && animationUiState.get().mode.kind === 'playback';
  },

  /** Take what presenting replaced out, to present again over it (the
   *  host loading another doc leaves the mode in between). */
  suspend(): Before | null {
    const from = presentActions.isPresenting() ? before : null;
    before = null;
    return from;
  },

  /** The play bar's Close: back to the panels, ribbon and mode from before
   *  presenting — authoring again, or animation mode off (the scene
   *  restored); `leave` turns the mode off whatever it was (the host's
   *  setMode off). Without a present to undo, animation mode is left. */
  async close(opts: { leave?: boolean } = {}): Promise<void> {
    const from = presentActions.isPresenting() ? before : null;
    before = null;
    if (!from) {
      await animationUiActions.exitMode();
      return;
    }
    playerActions.pause();
    if (from.layout) {
      layoutsActions.restore(from.layout);
    }
    if (from.mode === 'author' && !opts.leave) {
      await animationUiActions.enterAuthoring();
      return;
    }
    if (from.mode === 'off' || opts.leave) {
      await animationUiActions.exitMode();
    }
  },
};
