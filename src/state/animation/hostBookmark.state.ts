// The host's animation bookmark button (postMessage
// `animation.setBookmarkButton`): a big button in its own Bookmark section of
// the Animation ribbon. SESSION-ONLY — never persisted; a reload drops it
// until the host sets it again after `app.ready`.

import { createStore } from '@treDeSpaceUI/lib/createStore';

export interface HostBookmarkState {
  /** the button the host set, or null (no Bookmark section) */
  button: { label: string; tooltip: string } | null;
}

export const hostBookmarkState = createStore<HostBookmarkState>({ button: null });
