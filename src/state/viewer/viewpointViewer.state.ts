// How the Viewpoint Viewer panel shows the viewpoints: the whole list, or one
// at a time. A display choice of the panel, remembered across sessions (the
// viewpoints themselves are not — see viewpoints.state.ts).
import { createStore } from '@treDeSpaceUI/lib/createStore';
import { storageKey } from '../../lib/storageKeys';

export interface ViewpointViewerState {
  /** true = only the active viewpoint is shown, stepped with the previous / next arrows. */
  oneAtATime: boolean;
}

export const VIEWPOINT_VIEWER_KEY = storageKey('viewpointViewer');

const DEFAULTS: ViewpointViewerState = { oneAtATime: false };

function load(): ViewpointViewerState {
  try {
    const raw = localStorage.getItem(VIEWPOINT_VIEWER_KEY);
    if (raw) {
      const saved: unknown = JSON.parse(raw);
      if (typeof saved === 'object' && saved !== null && 'oneAtATime' in saved) {
        return { oneAtATime: saved.oneAtATime === true };
      }
    }
  } catch {
    // defaults
  }
  return DEFAULTS;
}

export const viewpointViewerState = createStore<ViewpointViewerState>(load());
