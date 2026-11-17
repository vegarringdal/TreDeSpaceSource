// Panel-local staging selection, exposed to the global hotkeys (same
// register-callback pattern as registerHierarchyCollapse etc).
interface StagingSelect {
  all(): void;
  none(): void;
}

let current: StagingSelect | null = null;

export function registerStagingSelect(cb: StagingSelect | null) {
  current = cb;
}

export const stagingSelectAll = () => current?.all();
export const stagingSelectNone = () => current?.none();

let searchExact: (() => void) | null = null;

export function registerAssetsSearchExact(cb: (() => void) | null) {
  searchExact = cb;
}

export const toggleAssetsSearchExact = () => searchExact?.();
