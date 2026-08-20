import type { Store } from '@treDeSpaceUI/lib/createStore';
import { createContext } from 'react';
import { type MultiColorActions, multiColorActions } from './multiColor.actions';
import { type MultiColorState, multiColorState } from './multiColor.state';

/** Which store/actions this editor instance is bound to — the global pair by
 *  default; the "(viewpoint)" panel provides the active viewpoint's own. */
export const MultiColorCtx = createContext<{ store: Store<MultiColorState>; act: MultiColorActions }>({
  store: multiColorState,
  act: multiColorActions,
});
export const MultiColorProvider = MultiColorCtx.Provider;
