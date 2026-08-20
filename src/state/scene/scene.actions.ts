import { consoleActions } from '../../components/panels/console/console.actions';
import { initialSceneState, type SceneState, sceneState } from './scene.state';

/**
 * The only writers of scene state. Actions may call other stores' actions —
 * here the console gets its log lines without the scene store carrying them.
 */
export const sceneActions = {
  /** Apply a patch; the optional note is logged only when something changed. */
  update(patch: Partial<SceneState>, note?: string) {
    const before = sceneState.get();
    const changed = (Object.keys(patch) as Array<keyof SceneState>).some((k) => before[k] !== patch[k]);
    if (!changed) {
      return;
    }
    sceneState.set(patch);
    if (note) {
      consoleActions.log('info', note);
    }
  },

  reset() {
    sceneState.set(initialSceneState);
    consoleActions.log('warn', 'Scene reset to defaults');
  },
};
