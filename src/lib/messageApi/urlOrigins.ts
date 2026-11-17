// What the `?apiOrigins=` URL parameter is worth, by where the viewer runs.
// The parameter is written by whoever built the URL, so it is a request, not
// a credential: it may be granted without a question only where granting it
// gives nothing away. Pure — no store or DOM imports — so it is unit-tested.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** `frame` = embedded in another page; `popup` = a window another page
 *  opened; `top` = a window nobody can post commands to. */
export type WindowRole = 'frame' | 'popup' | 'top';

export type UrlOriginsDecision =
  | Readonly<{ kind: 'ignore' }>
  | Readonly<{ kind: 'trust-session'; origins: readonly string[] }>
  | Readonly<{ kind: 'ask'; origins: readonly string[] }>;

export interface UrlOriginsContext {
  readonly origins: readonly string[];
  readonly role: WindowRole;
  /** The viewer holds no models and no databases in this storage. */
  readonly isStorageEmpty: boolean;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PARAM = 'apiOrigins';
const ANY_ORIGIN = '*';

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

/** The origins a URL asks for: comma-separated, trimmed, each once. `*` is
 *  dropped — a URL can never ask for every origin. */
export function parseUrlOrigins(search: string): string[] {
  const raw = new URLSearchParams(search).get(PARAM) ?? '';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== ANY_ORIGIN);

  return [...new Set(origins)];
}

/**
 * Whether the origins a URL names are granted, asked about or ignored.
 *
 * A framed viewer is only as isolated as the browser's storage partition,
 * and that is cut per SITE, not per origin: any page on the viewer's own
 * registrable domain frames it with the user's real data (as does every page
 * where partitioning is switched off by policy). So a frame is trusted
 * without a question only while there is nothing to read; once the viewer
 * holds data the user decides, as for a window another page opened. The
 * silent grant lasts for the session and is never saved — a page that framed
 * the viewer while it was empty gains nothing over the data that comes later.
 */
export function decideUrlOrigins(context: UrlOriginsContext): UrlOriginsDecision {
  const { origins, role, isStorageEmpty } = context;
  if (origins.length === 0 || role === 'top') {
    return { kind: 'ignore' };
  }

  if (role === 'frame' && isStorageEmpty) {
    return { kind: 'trust-session', origins };
  }

  return { kind: 'ask', origins };
}
