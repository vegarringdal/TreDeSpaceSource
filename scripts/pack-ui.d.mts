// Types for pack-ui.mjs so vite.config.ts (type-checked) can import it.
export interface PackResult {
  tgzPath: string;
  fileName: string;
  version: string;
}
export function packUi(): PackResult;
