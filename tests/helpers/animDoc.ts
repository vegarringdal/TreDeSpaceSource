// Builders for animation-core tests: object keys, objects, a scene and a doc
// around it. Defaults follow the authoring defaults (smooth keys, centre
// pivot, straight path).
import { emptyScene } from '../../src/lib/animation/io';
import {
  ANIMATION_FORMAT,
  ANIMATION_VERSION,
  type AnimationDoc,
  type AnimObject,
  type ObjectKey,
  type Scene,
  type V3,
} from '../../src/lib/animation/types';

export const ID_Q: [number, number, number, number] = [0, 0, 0, 1];

export function key(t: number, move: V3 = [0, 0, 0], patch: Partial<ObjectKey> = {}): ObjectKey {
  return { t, move, rotate: [...ID_Q], interp: 'linear', ...patch };
}

export function object(id: string, keys: ObjectKey[], patch: Partial<AnimObject> = {}): AnimObject {
  return { id, name: id, items: [`/${id}`], pivot: 'center', path: 'straight', keys, ...patch };
}

export function scene(patch: Partial<Scene> = {}): Scene {
  return { ...emptyScene('Test'), id: 's1', ...patch };
}

export function doc(scenes: Scene[] = [scene()], patch: Partial<AnimationDoc> = {}): AnimationDoc {
  return {
    format: ANIMATION_FORMAT,
    version: ANIMATION_VERSION,
    name: 'Test',
    scenes,
    overlayInstances: [],
    overlayComponents: [],
    overlayThemes: [],
    ...patch,
  };
}
