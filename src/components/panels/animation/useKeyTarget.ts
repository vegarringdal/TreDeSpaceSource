import type { AnimObject, Callout, Scene, Step } from '../../../lib/animation/types';
import type { OverlayInstance } from '../../../lib/overlay/overlayTypes';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { animationUiState } from '../../../state/animation/animationUi.state';
import type { AnnotationKind } from '../../../state/animation/annotations.actions';
import { activeScene } from '../../../state/animation/docEdit';
import { rowObject } from '../../../state/animation/rows';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

/** What the Key panel shows (DESIGN.md › Animation › Authoring). */
export type KeyTarget =
  | { kind: 'off' }
  | { kind: 'objectKey'; scene: Scene; object: AnimObject; index: number; indices: number[] }
  /** an object row, no key picked: the next key at the time slider */
  | { kind: 'object'; scene: Scene; object: AnimObject }
  | { kind: 'camera'; scene: Scene; index: number | null; indices: number[] }
  | { kind: 'section'; scene: Scene; index: number | null; indices: number[] }
  | { kind: 'rules'; scene: Scene; index: number | null }
  /** the Labels or Measurements row, or one of its keys */
  | { kind: 'annotations'; annotation: AnnotationKind; scene: Scene; index: number | null }
  | { kind: 'step'; scene: Scene; step: Step }
  | { kind: 'steps'; scene: Scene }
  | { kind: 'callout'; scene: Scene; callout: Callout; instance: OverlayInstance | null; keys: number[] }
  | { kind: 'callouts'; scene: Scene }
  | { kind: 'objects'; scene: Scene }
  | { kind: 'scene'; scene: Scene };

// -----------------------------------------------------------------------------
// hook
// -----------------------------------------------------------------------------

/** The Key panel's target from the picked key / step / callout and the
 *  current row; re-renders on doc and UI changes. */
export function useKeyTarget(): KeyTarget {
  const ui = animationUiState.use();
  const doc = animationDocState.use().doc;
  const scene = activeScene(doc);
  // nothing to edit while playing back only (presenting, a host)
  if (ui.mode.kind !== 'author' || !scene) {
    return { kind: 'off' };
  }
  const p = ui.picked;
  if (p.kind === 'keys') {
    const object = scene.objects.find((o) => o.id === rowObject(p.row));
    const index = p.indices[0];
    if (object && index !== undefined && object.keys[index]) {
      return { kind: 'objectKey', scene, object, index, indices: p.indices };
    }
    if (p.row === '@camera' && index !== undefined && scene.camera[index]) {
      return { kind: 'camera', scene, index, indices: p.indices };
    }
    if (p.row === '@section' && index !== undefined && scene.section[index]) {
      return { kind: 'section', scene, index, indices: p.indices };
    }
    if (p.row === '@rules' && index !== undefined && scene.colorRules[index]) {
      return { kind: 'rules', scene, index };
    }
    if (p.row === '@labels' && index !== undefined && scene.labels[index]) {
      return { kind: 'annotations', annotation: 'labels', scene, index };
    }
    if (p.row === '@measurements' && index !== undefined && scene.measurements[index]) {
      return { kind: 'annotations', annotation: 'measurements', scene, index };
    }
  }
  if (p.kind === 'step') {
    const step = scene.steps.find((s) => s.id === p.id);
    if (step) {
      return { kind: 'step', scene, step };
    }
  }
  if (p.kind === 'callout') {
    const callout = scene.callouts.find((c) => c.id === p.id);
    if (callout) {
      const instance = doc.overlayInstances.find((i) => i.id === callout.instance) ?? null;
      return { kind: 'callout', scene, callout, instance, keys: p.keys };
    }
  }
  const object = scene.objects.find((o) => o.id === rowObject(ui.current));
  if (object) {
    return { kind: 'object', scene, object };
  }
  switch (ui.current) {
    case '@camera':
      return { kind: 'camera', scene, index: null, indices: [] };
    case '@section':
      return { kind: 'section', scene, index: null, indices: [] };
    case '@rules':
      return { kind: 'rules', scene, index: null };
    case '@labels':
      return { kind: 'annotations', annotation: 'labels', scene, index: null };
    case '@measurements':
      return { kind: 'annotations', annotation: 'measurements', scene, index: null };
    case '@steps':
      return { kind: 'steps', scene };
    case '@scene':
      return { kind: 'scene', scene };
    case '@callouts':
      return { kind: 'callouts', scene };
    case '@objects':
      return { kind: 'objects', scene };
    default:
      return { kind: 'scene', scene };
  }
}
