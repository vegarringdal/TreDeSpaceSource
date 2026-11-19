// Stepping through the viewpoint list (the Viewpoint Viewer's previous / next
// arrows and their hotkeys). Pure — no stores — so it is unit-tested.

/** The id Prev (`dir` -1) or Next (`dir` 1) should activate, or null when
 *  there is nowhere to go: the list is empty, or the active viewpoint is
 *  already the first / last (stepping does not wrap around). With no active
 *  viewpoint Next starts at the first and Prev at the last. */
export function viewpointStepId(ids: readonly string[], activeId: string | null, dir: -1 | 1): string | null {
  if (ids.length === 0) {
    return null;
  }
  const at = activeId === null ? -1 : ids.indexOf(activeId);
  if (at < 0) {
    return dir === 1 ? ids[0] : ids[ids.length - 1];
  }

  return ids[at + dir] ?? null;
}
