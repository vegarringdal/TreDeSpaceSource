// The Key panel's colour-rules editor (DESIGN.md › Animation › Authoring):
// the Set Color rule editor bound to the picked colour-rules key, or — with
// the Colour rules row current and no key picked — to the next rules key, a
// draft previewed on the scene until Key keys it. Same shape as the Set
// Color panel's state, so its RuleEditor edits it unchanged.

import { createStore } from '@treDeSpaceUI/lib/createStore';
import type { MultiColorState } from '../../components/panels/multi-color/multiColor.state';

/** The next rules key before anything is added: on top of the rules in
 *  force, nothing yet. */
export const emptyRulesDraft = (): MultiColorState => ({
  mode: 'append',
  rules: [],
  counts: [],
  collapsed: [],
  running: false,
});

export const rulesEditorState = createStore<MultiColorState>(emptyRulesDraft());
