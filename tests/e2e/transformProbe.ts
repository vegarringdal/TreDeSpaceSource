// In-page probe for the transform objects end-to-end suite (scripts/
// anim-e2e.mjs --suite transform): a clean slate — no objects, nothing moved,
// not animating — and read-backs of the object list. The shared helpers
// (select, drag, center, settle…) are the animation probe's.

import { dialogs } from '../../src/components/dialogs/dialogs.actions';
import { emptyDoc } from '../../src/lib/animation/io';
import { poseSummary } from '../../src/lib/transform/summary';
import { animationDocActions } from '../../src/state/animation/animationDoc.actions';
import { activeScene } from '../../src/state/animation/docEdit';
import { animationUiActions } from '../../src/state/animation/animationUi.actions';
import { animationUiState } from '../../src/state/animation/animationUi.state';
import { transformActions } from '../../src/state/transform/transform.actions';
import { transformState } from '../../src/state/transform/transform.state';
import { requestTransformSync } from '../../src/state/transform/transformSync';
import { viewerActions } from '../../src/state/viewer/viewer.actions';
import { settle } from './animProbe';

export { center, childrenOf, drag, gizmo, minX, select, selectionCount, settle } from './animProbe';

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** No objects, nothing moved, nothing selected, not animating, an empty
 *  animation. */
export async function reset(): Promise<void> {
  dialogs.confirm = async () => true;
  if (animationUiState.get().mode.kind !== 'off') {
    await animationUiActions.exitMode();
  }
  await animationDocActions.adopt(emptyDoc('E2E'), null, false);
  transformActions.dropForSnapshot();
  await requestTransformSync('items', true);
  await viewerActions.clearSelection();
  await settle();
}

/** Wait until the worker and the view show the object list. */
export async function sync(): Promise<void> {
  await requestTransformSync('pose');
  await settle();
}

/** Enter / leave animation authoring (it starts clean). */
export async function animate(on: boolean): Promise<void> {
  if (on) {
    await animationUiActions.enterAuthoring();
  } else {
    await animationUiActions.exitMode();
  }
  await settle();
}

/** The animation's active scene objects (what To animation made). */
export function animObjects(): {
  name: string;
  parent: string | null;
  items: string[];
  exclude: string[];
  pivot: unknown;
  keys: { t: number; move: number[] }[];
}[] {
  const objects = activeScene()?.objects ?? [];
  return objects.map((o) => ({
    name: o.name,
    parent: objects.find((x) => x.id === o.parent)?.name ?? null,
    items: o.items,
    exclude: o.exclude ?? [],
    pivot: o.pivot,
    keys: o.keys.map((k) => ({ t: k.t, move: k.move.map(round) })),
  }));
}

/** The object list as the panel shows it. */
export function state(): {
  current: string | null;
  undo: number;
  redo: number;
  objects: {
    id: string;
    name: string;
    parent: string | null;
    move: number[];
    scale: number[];
    pivot: { at: unknown; offset: number[] };
    summary: string;
    muted: boolean;
    items: number;
    nodes: string[];
    leftOut: string[];
  }[];
} {
  const s = transformState.get();
  const nameOf = (id: string | null | undefined) => s.objects.find((o) => o.id === id)?.name ?? null;
  return {
    current: nameOf(s.currentId),
    undo: s.undoDepth,
    redo: s.redoDepth,
    objects: s.objects.map((o) => ({
      id: o.id,
      name: o.name,
      parent: nameOf(o.parent),
      move: o.move.map(round),
      scale: o.scale.map(round),
      pivot: { at: o.pivot.at, offset: (o.pivot.offset ?? [0, 0, 0]).map(round) },
      summary: poseSummary(o),
      muted: o.muted === true,
      items: s.info[o.id]?.items ?? 0,
      nodes: o.items,
      leftOut: o.exclude ?? [],
    })),
  };
}
