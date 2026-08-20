// The Hierarchy tree owns its expand state locally; this tiny registry lets a
// global hotkey reach it (same pattern as registerRenderer). The panel
// registers its collapse-all handler on mount and clears it on unmount.

let collapseAllFn: (() => void) | null = null;

export function registerHierarchyCollapse(fn: (() => void) | null) {
  collapseAllFn = fn;
}

/** Collapse every expanded node in the hierarchy tree (no-op if unmounted). */
export function collapseHierarchy() {
  collapseAllFn?.();
}
