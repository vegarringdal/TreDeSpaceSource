// postMessage API security (Settings → External): who may send commands.
// Cross-origin pages can NEVER touch the app's DOM/globals — the browser
// enforces that. postMessage is the only channel, and the API surface is the
// validated command list in src/lib/messageApi.ts. These settings control
// which ORIGINS may use that channel at all.
import { createStore } from '@treDeSpaceUI/lib/createStore';

export interface ApiSecurityState {
  /** Master switch for the postMessage API (same-origin included). */
  enabled: boolean;
  /** Extra allowed origins, e.g. https://portal.example.com. */
  origins: string[];
  /** Honor ?apiOrigins= from the embedding URL. Inside an iframe that only
   *  exposes the embedder's own (storage-partitioned) viewer instance to
   *  itself; in a window another page opened the viewer asks the user first
   *  (src/lib/messageApi/index.ts). Off = strict settings-only allowlist. */
  allowUrlParam: boolean;
}

const KEY = 'apiSecurity';

function load(): ApiSecurityState {
  const fallback: ApiSecurityState = { enabled: true, origins: [], allowUrlParam: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return fallback;
    }
    const saved = JSON.parse(raw) as Partial<ApiSecurityState>;
    return {
      enabled: saved.enabled !== false,
      origins: Array.isArray(saved.origins) ? saved.origins.filter((o) => typeof o === 'string') : [],
      allowUrlParam: saved.allowUrlParam !== false,
    };
  } catch {
    return fallback;
  }
}

export const apiSecurityState = createStore<ApiSecurityState>(load());

apiSecurityState.subscribe(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(apiSecurityState.get()));
  } catch {
    // storage unavailable — non-fatal
  }
});
