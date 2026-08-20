import { createStore } from '@treDeSpaceUI/lib/createStore';

export interface RibbonHomeState {
  camera: 'persp' | 'ortho';
  /** Which side panels are shown. */
  panels: { settings: boolean; viewport: boolean; tree: boolean };
}

export const ribbonHomeState = createStore<RibbonHomeState>({
  camera: 'persp',
  panels: { settings: true, viewport: true, tree: true },
});
