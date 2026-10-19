// The host's animation bookmark button (hostBookmark.state.ts): set by the
// host, clicked by the user — the click hands the CURRENT animation to the
// host as the `animation.bookmark` event, so it can persist it and later
// load and present it again (`animation.present`).

import type { AnimationDoc } from '../../lib/animation/types';
import { emitApiEvent } from '../../lib/messageApi/transport';
import { animationDocActions } from './animationDoc.actions';
import { hostBookmarkState } from './hostBookmark.state';

export const hostBookmarkActions = {
  /** Show / replace the button, or remove it (null). */
  setButton(button: { label: string; tooltip: string } | null): void {
    hostBookmarkState.set({ button });
  },

  /** What the bookmark event carries: the button's label and the animation
   *  as Save writes it (overlay designs and themes embedded); null without a
   *  button. */
  payload(): { label: string; doc: AnimationDoc } | null {
    const button = hostBookmarkState.get().button;
    return button ? { label: button.label, doc: animationDocActions.docForSave() } : null;
  },

  /** The user clicked the button: the host gets the animation. */
  clicked(): void {
    const payload = hostBookmarkActions.payload();
    if (payload) {
      emitApiEvent('animation.bookmark', payload);
    }
  },
};
