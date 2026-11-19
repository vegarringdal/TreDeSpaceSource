import { VIEWPOINT_VIEWER_KEY, viewpointViewerState } from './viewpointViewer.state';

function persist(): void {
  try {
    localStorage.setItem(VIEWPOINT_VIEWER_KEY, JSON.stringify(viewpointViewerState.get()));
  } catch {
    // storage unavailable: the choice lasts for the session only
  }
}

export const viewpointViewerActions = {
  /** Switch the Viewpoint Viewer between the whole list and one viewpoint at
   *  a time (button + hotkey). */
  toggleOneAtATime() {
    viewpointViewerState.set((s) => ({ oneAtATime: !s.oneAtATime }));
    persist();
  },
};
