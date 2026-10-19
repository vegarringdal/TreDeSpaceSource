// Immutable doc edits shared by the edit action modules: the active scene,
// and one scene or object replaced. Pure helpers over the doc; the actions
// commit their results.

import type { AnimationDoc, AnimObject, Scene } from '../../lib/animation/types';
import { animationDocState } from './animationDoc.state';

/** The scene the editors and playback work on (the first when the active
 *  id is stale). */
export function activeScene(doc: AnimationDoc = animationDocState.get().doc): Scene | null {
  const id = animationDocState.get().activeScene;
  return doc.scenes.find((s) => s.id === id) ?? doc.scenes[0] ?? null;
}

/** The doc with one scene replaced by `fn(scene)` (unchanged → same doc). */
export function mapScene(doc: AnimationDoc, sceneId: string, fn: (s: Scene) => Scene): AnimationDoc {
  let changed = false;
  const scenes = doc.scenes.map((s) => {
    if (s.id !== sceneId) {
      return s;
    }
    const next = fn(s);
    changed ||= next !== s;
    return next;
  });
  return changed ? { ...doc, scenes } : doc;
}

/** The doc with the active scene replaced by `fn(scene)`. */
export function mapActiveScene(doc: AnimationDoc, fn: (s: Scene) => Scene): AnimationDoc {
  const s = activeScene(doc);
  return s ? mapScene(doc, s.id, fn) : doc;
}

/** The scene holding an object, and the object. */
export function findObject(doc: AnimationDoc, id: string): { scene: Scene; object: AnimObject } | null {
  for (const scene of doc.scenes) {
    const object = scene.objects.find((o) => o.id === id);
    if (object) {
      return { scene, object };
    }
  }
  return null;
}

/** The doc with one object replaced by `fn(object)`. */
export function mapObject(doc: AnimationDoc, id: string, fn: (o: AnimObject) => AnimObject): AnimationDoc {
  const hit = findObject(doc, id);
  if (!hit) {
    return doc;
  }
  return mapScene(doc, hit.scene.id, (s) => {
    const objects = s.objects.map((o) => (o.id === id ? fn(o) : o));
    return objects.some((o, i) => o !== s.objects[i]) ? { ...s, objects } : s;
  });
}
