// Per-app iframe policy for external apps: what a hosted page may do beyond
// the always-on base. Both option lists are OPTIONAL and default to empty, so
// an app saved before they existed renders with exactly the attributes it
// always had.
//
// What the sandbox does NOT do: cross-frame DOM and storage access is
// governed by the same-origin policy, not by these flags. A page on another
// origin can never read this viewer's document, localStorage or cookies
// whatever is set here — it only reaches the viewer through postMessage. A
// page on the VIEWER'S OWN origin is the exception: with scripts and
// same-origin both allowed it can read everything in the viewer window, and
// no sandbox option changes that — hence `isViewerOriginUrl` and the warnings
// built on it.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Sandbox opt-ins beyond the base set. Top navigation is never offered — it
 *  would let a tool redirect the whole viewer to a page of its choosing. */
export type SandboxOption = 'popups' | 'modals' | 'pointer-lock' | 'storage-access';

/** Permissions-Policy features delegated through the iframe `allow`
 *  attribute. None is delegated unless listed — the browser default for a
 *  cross-origin frame. */
export type PermissionOption =
  | 'camera'
  | 'microphone'
  | 'geolocation'
  | 'fullscreen'
  | 'clipboard-read'
  | 'clipboard-write'
  | 'autoplay'
  | 'display-capture'
  | 'publickey-credentials-get'
  | 'identity-credentials-get'
  | 'web-share'
  | 'picture-in-picture'
  | 'payment';

/** One option as the settings editor shows it. */
export interface PolicyOptionDoc<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly tooltip: string;
}

/** The two iframe attributes an app's options resolve to. `allow` is
 *  undefined (attribute omitted) when nothing is delegated. */
export interface IframePolicy {
  readonly sandbox: string;
  readonly allow: string | undefined;
}

/** The option fields an app carries; both absent = the base policy. */
export interface PolicyFields {
  readonly sandbox?: readonly SandboxOption[];
  readonly allow?: readonly PermissionOption[];
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Always on: the page runs scripts on its own origin (its own site's
 *  cookies and storage, and a real origin for the postMessage allowlist),
 *  submits forms and downloads files. */
const SANDBOX_BASE = 'allow-scripts allow-same-origin allow-forms allow-downloads';

const SANDBOX_TOKENS: Record<SandboxOption, string> = {
  // a popup that inherits the sandbox is useless for sign-in flows, so the
  // escape flag always rides along
  popups: 'allow-popups allow-popups-to-escape-sandbox',
  modals: 'allow-modals',
  'pointer-lock': 'allow-pointer-lock',
  'storage-access': 'allow-storage-access-by-user-activation',
};

export const SANDBOX_OPTIONS: readonly PolicyOptionDoc<SandboxOption>[] = [
  {
    value: 'popups',
    label: 'Popups',
    tooltip:
      'window.open and target=_blank links open a normal browser tab (allow-popups + allow-popups-to-escape-sandbox). Off: silently blocked.',
  },
  {
    value: 'modals',
    label: 'Modals',
    tooltip: 'alert / confirm / prompt / print dialogs (allow-modals). Off: silently swallowed.',
  },
  {
    value: 'pointer-lock',
    label: 'Pointer lock',
    tooltip: 'Capture the mouse, e.g. for first-person controls (allow-pointer-lock).',
  },
  {
    value: 'storage-access',
    label: 'Storage access',
    tooltip:
      "Let the page ask the browser for its own UNPARTITIONED cookies and storage through the Storage Access API (a browser prompt) — for an SSO session that does not reach a nested frame (allow-storage-access-by-user-activation). Never grants anything of the viewer's.",
  },
];

export const PERMISSION_OPTIONS: readonly PolicyOptionDoc<PermissionOption>[] = [
  { value: 'camera', label: 'Camera', tooltip: 'Delegate camera access (allow="camera").' },
  { value: 'microphone', label: 'Microphone', tooltip: 'Delegate microphone access (allow="microphone").' },
  { value: 'geolocation', label: 'Geolocation', tooltip: 'Delegate location access (allow="geolocation").' },
  {
    value: 'fullscreen',
    label: 'Fullscreen',
    tooltip: 'Let the page go fullscreen (allow="fullscreen").',
  },
  {
    value: 'clipboard-read',
    label: 'Clipboard read',
    tooltip: 'Async clipboard reads (allow="clipboard-read").',
  },
  {
    value: 'clipboard-write',
    label: 'Clipboard write',
    tooltip: 'Async clipboard writes, e.g. a Copy button (allow="clipboard-write").',
  },
  { value: 'autoplay', label: 'Autoplay', tooltip: 'Media may autoplay with sound (allow="autoplay").' },
  {
    value: 'display-capture',
    label: 'Screen capture',
    tooltip: 'Screen / window capture (allow="display-capture").',
  },
  {
    value: 'publickey-credentials-get',
    label: 'Passkeys',
    tooltip: 'WebAuthn / passkey sign-in inside the frame (allow="publickey-credentials-get").',
  },
  {
    value: 'identity-credentials-get',
    label: 'Federated sign-in',
    tooltip: 'FedCM federated sign-in inside the frame (allow="identity-credentials-get").',
  },
  { value: 'web-share', label: 'Web Share', tooltip: 'navigator.share (allow="web-share").' },
  {
    value: 'picture-in-picture',
    label: 'Picture-in-picture',
    tooltip: 'Video picture-in-picture (allow="picture-in-picture").',
  },
  { value: 'payment', label: 'Payment', tooltip: 'Payment Request API (allow="payment").' },
];

const SANDBOX_VALUES: readonly SandboxOption[] = SANDBOX_OPTIONS.map((o) => o.value);
const PERMISSION_VALUES: readonly PermissionOption[] = PERMISSION_OPTIONS.map((o) => o.value);

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function isSandboxOption(v: unknown): v is SandboxOption {
  return typeof v === 'string' && SANDBOX_VALUES.some((s) => s === v);
}

function isPermissionOption(v: unknown): v is PermissionOption {
  return typeof v === 'string' && PERMISSION_VALUES.some((s) => s === v);
}

/** Split an untrusted list into the known options (deduplicated, in declared
 *  order, so the attributes come out deterministic) and the strings that are
 *  not options — a saved blob drops those, the API rejects them. Anything
 *  that is not an array counts as empty. */
function readList<T extends string>(
  v: unknown,
  valid: readonly T[],
  isValid: (x: unknown) => x is T,
): { list: T[]; unknown: string[] } {
  if (!Array.isArray(v)) {
    return { list: [], unknown: [] };
  }
  const list = valid.filter((o) => v.includes(o));
  const unknown = v.filter((x) => !isValid(x)).map((x) => String(x));
  return { list, unknown };
}

export function readSandboxOptions(v: unknown): { list: SandboxOption[]; unknown: string[] } {
  return readList(v, SANDBOX_VALUES, isSandboxOption);
}

export function readPermissionOptions(v: unknown): { list: PermissionOption[]; unknown: string[] } {
  return readList(v, PERMISSION_VALUES, isPermissionOption);
}

/** Add or remove one option, keeping declared order. */
export function togglePolicyOption<T extends string>(
  list: readonly T[] | undefined,
  valid: readonly PolicyOptionDoc<T>[],
  value: T,
  on: boolean,
): T[] {
  const current = new Set(list ?? []);
  if (on) {
    current.add(value);
  } else {
    current.delete(value);
  }
  return valid.map((o) => o.value).filter((o) => current.has(o));
}

/** The iframe attributes for an app — the base sandbox plus its opt-ins, and
 *  the `allow` list joined the way Permissions Policy expects. */
export function externalAppIframePolicy(a: PolicyFields): IframePolicy {
  const sandbox = readSandboxOptions(a.sandbox).list;
  const allow = readPermissionOptions(a.allow).list;
  return {
    sandbox: [SANDBOX_BASE, ...sandbox.map((s) => SANDBOX_TOKENS[s])].join(' '),
    allow: allow.length ? allow.join('; ') : undefined,
  };
}

/** True when the URL resolves to THIS viewer's origin and is not the bundled
 *  demo: such a page shares the viewer's origin, so the sandbox cannot keep
 *  it out of the viewer window (its DOM, storage, everything). */
export function isViewerOriginUrl(url: string): boolean {
  try {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) {
      return false;
    }
    const demo = new URL('demo/', document.baseURI).href;
    return !u.href.startsWith(demo);
  } catch {
    return false;
  }
}

/** Shown in the editor and returned by `externalApps.set` for a same-origin app. */
export const VIEWER_ORIGIN_WARNING =
  'Same origin as the viewer: the page can read and change everything in this viewer window — a sandbox cannot isolate a same-origin page.';
