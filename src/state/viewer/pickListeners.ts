// A tiny fan-out for viewport item picks. selectFromPick emits (model, item)
// on every successful pick — alongside the normal selection, which is
// untouched — and panels that follow clicks (SQL Detail) subscribe while they
// are listening. Kept separate from selection state so a subscriber never
// perturbs navigation.
export interface Pick {
  model: number;
  item: number;
}

type PickFn = (pick: Pick) => void;
const listeners = new Set<PickFn>();
let lastPick: Pick | null = null;

/** Subscribe to viewport picks; returns an unsubscribe. */
export function onViewportPick(fn: PickFn): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Emitted by selectFromPick after a hit resolves. */
export function emitViewportPick(model: number, item: number) {
  lastPick = { model, item };
  for (const fn of listeners) {
    fn({ model, item });
  }
}

/** The most recent viewport pick — lets the SQL Editor rebuild TREE_VIEW_ARGS
 *  from the last click without re-clicking the model. */
export function getLastPick(): Pick | null {
  return lastPick;
}
