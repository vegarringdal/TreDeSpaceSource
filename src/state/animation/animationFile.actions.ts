// Opening and saving animation files from anywhere (Player, Animation panel,
// ribbon, hotkeys). Loading while animation mode is on leaves the mode first
// and re-enters it on the new doc, so the worker capture always matches the
// doc being played.

import { toast } from '@treDeSpaceUI/widgets';
import { pickTextFile } from '../../lib/pickFile';
import { animationDocActions } from './animationDoc.actions';
import { animationUiActions } from './animationUi.actions';
import { animationUiState } from './animationUi.state';

export const ANIMATION_FILE_ACCEPT = '.json,.tdanim.json,application/json';

export const animationFileActions = {
  /** Pick a `*.tdanim.json`; afterwards the mode it was in (or playback when
   *  `play`) is entered on the new doc. */
  async open(opts: { play?: boolean } = {}): Promise<boolean> {
    const file = await pickTextFile(ANIMATION_FILE_ACCEPT);
    if (!file) {
      return false;
    }
    return animationFileActions.loadText(file.text, file.name, opts);
  },

  async loadText(text: string, fileName: string | null, opts: { play?: boolean } = {}): Promise<boolean> {
    const before = animationUiState.get().mode.kind;
    const wasOn = before !== 'off';
    if (wasOn) {
      await animationUiActions.exitMode();
    }
    const report = await animationDocActions.loadFromText(text, fileName);
    if (!report.ok) {
      if (report.errors[0] !== 'cancelled') {
        toast.error(report.errors.join('\n'), { title: 'Animation not loaded' });
      }
      if (wasOn) {
        await (before === 'playback' ? animationUiActions.enterPlayback() : animationUiActions.enterAuthoring());
      }
      return false;
    }
    toast.success(`Loaded "${fileName ?? 'animation'}".`);
    if (opts.play || before === 'playback') {
      await animationUiActions.enterPlayback();
    } else if (wasOn) {
      await animationUiActions.enterAuthoring();
    }
    return true;
  },

  save(): void {
    animationDocActions.saveToFile();
  },

  /** New animation; a running mode is left first and entered again on the
   *  new doc (the player would keep the old timeline otherwise). */
  async newAnimation(): Promise<boolean> {
    return withModeRestart(() => animationDocActions.newDoc());
  },

  /** Recover the autosaved draft, the same way. */
  async recoverDraft(): Promise<boolean> {
    return withModeRestart(() => animationDocActions.recoverDraft());
  },
};

/** Leave animation mode around a doc swap and come back to the same mode. */
async function withModeRestart(swap: () => Promise<boolean>): Promise<boolean> {
  const before = animationUiState.get().mode.kind;
  if (before !== 'off') {
    await animationUiActions.exitMode();
  }
  const ok = await swap();
  if (before === 'playback') {
    await animationUiActions.enterPlayback();
  } else if (before !== 'off') {
    await animationUiActions.enterAuthoring();
  }
  return ok;
}
