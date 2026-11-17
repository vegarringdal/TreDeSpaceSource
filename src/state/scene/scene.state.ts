import { createStore } from '@treDeSpaceUI/lib/createStore';

export type Shape = 'knot' | 'box' | 'icosahedron';

/** Shared 3D-scene domain state — plain JSON, snapshot-friendly. */
export interface SceneState {
  shape: Shape;
  color: string;
  spin: number;
  scale: number;
  wireframe: boolean;
  grid: boolean;
  lightIntensity: number;
  selected: string;
  /** WASD keeps the camera at its current height when true. */
  walkMode: boolean;
}

export const initialSceneState: SceneState = {
  shape: 'knot',
  color: '#58a6ff',
  spin: 0.6,
  scale: 1,
  wireframe: false,
  grid: true,
  lightIntensity: 2.4,
  selected: 'Mesh',
  walkMode: false,
};

export const sceneState = createStore<SceneState>(initialSceneState);

export function useScene(): SceneState {
  return sceneState.use();
}
