// What playback is built from, as a revision number: it changes only when
// the active scene, the overlay instances or the embedded designs change —
// not for a rename of the animation or UI state. Derived work (problems,
// motion paths, swept bounds) is keyed on it instead of the doc revision.

import { animationDocState } from './animationDoc.state';

// -----------------------------------------------------------------------------
// module state
// -----------------------------------------------------------------------------

let lastInputs: readonly unknown[] = [];
let revision = 0;

// -----------------------------------------------------------------------------
// public api
// -----------------------------------------------------------------------------

/** The content revision of the active scene (see the module comment). */
export function contentRevision(): number {
  const { doc, activeScene } = animationDocState.get();
  const inputs = [
    activeScene,
    doc.scenes.find((x) => x.id === activeScene),
    doc.overlayInstances,
    doc.overlayComponents,
  ];
  if (inputs.length !== lastInputs.length || inputs.some((x, i) => x !== lastInputs[i])) {
    lastInputs = inputs;
    revision++;
  }
  return revision;
}
