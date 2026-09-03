// The most recent viewport pick. selectFromPick records it on every successful
// hit; lastSelectedTree falls back to it when nothing is selected, so the SQL
// Editor can rebuild TREE_VIEW_ARGS from the last click without re-clicking
// the model. Panels that follow clicks subscribe to onTreeSelect
// (lib/treeSelectEvent.ts), not here.
export interface Pick {
  model: number;
  item: number;
}

let lastPick: Pick | null = null;

/** Called by selectFromPick after a hit resolves. */
export function recordViewportPick(model: number, item: number) {
  lastPick = { model, item };
}

/** The most recent viewport pick, or null before the first one. */
export function getLastPick(): Pick | null {
  return lastPick;
}
