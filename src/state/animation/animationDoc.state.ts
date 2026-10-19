import { createStore } from '@treDeSpaceUI/lib/createStore';
import { emptyDoc } from '../../lib/animation/io';
import type { AnimationDoc } from '../../lib/animation/types';

/** The open animation document (DESIGN.md › Animation › Data model) and its
 *  editing meta. Mutations live in animationDoc.actions.ts (and the edit
 *  action modules next to it) — every edit replaces `doc` immutably and
 *  bumps `revision`. */
export interface AnimationDocState {
  doc: AnimationDoc;
  /** bumped on every edit, load and undo/redo */
  revision: number;
  /** edited since the last save / load */
  dirty: boolean;
  /** file the doc came from or was last saved as (download name) */
  fileName: string | null;
  /** the scene the Timeline, the Key panel and playback work on */
  activeScene: string;
  undoDepth: number;
  redoDepth: number;
  /** an autosaved draft from an earlier session is waiting to be recovered */
  draftAvailable: boolean;
}

const initialDoc = emptyDoc();

export const animationDocState = createStore<AnimationDocState>({
  doc: initialDoc,
  revision: 0,
  dirty: false,
  fileName: null,
  activeScene: initialDoc.scenes[0]?.id ?? '',
  undoDepth: 0,
  redoDepth: 0,
  draftAvailable: false,
});
