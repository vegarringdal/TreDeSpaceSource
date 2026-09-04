// External app panels: user-configured URLs (Settings → External) that open
// as iframe panels from the "External" ribbon. Hosted tools can drive the app
// through the postMessage API (EVENTS.md) — their origins are allowlisted
// automatically at boot.

import { createStore } from '@treDeSpaceUI/lib/createStore';
import { storageKey } from '../lib/storageKeys';
import {
  type PermissionOption,
  readPermissionOptions,
  readSandboxOptions,
  type SandboxOption,
} from './externalAppPolicy';

export type ExternalAppSize = 'big' | 'medium' | 'small';
/** Which end of the Home ribbon a promoted app's group sits at. */
export type HomePlacement = 'start' | 'end';

export interface ExternalApp {
  id: string;
  /** ribbon button + panel title */
  name: string;
  url: string;
  /** allow several instances of this app open at once */
  multiple: boolean;
  /** ribbon section title — apps sharing a section are grouped together */
  section: string;
  /** ribbon button size */
  size: ExternalAppSize;
  /** button tooltip (falls back to the URL when empty) */
  tooltip: string;
  /** open in a new browser window/tab instead of an in-app panel */
  newWindow: boolean;
  /** open automatically at app start (e.g. a project selector) */
  openOnStart: boolean;
  /** Put the button in the HOME ribbon instead of External — for tools the
   *  user should see immediately (a project selector, a report picker). */
  home: boolean;
  /** Which end of the Home ribbon it sits at — before the app's own groups
   *  ('start', default) or after them ('end'). Ignored unless `home`. */
  homeAt: HomePlacement;
  /** open as a centered modal dialog over the app (never blocks the app's own
   *  loading/error/confirm dialogs — those layer above it) */
  modal: boolean;
  /** JSON config passed to the page as a stringified `?config=` URL param */
  config: string;
  /** Sandbox opt-ins beyond the base set (popups, modals, …) — OPTIONAL, and
   *  absent means exactly the base policy every app has always had. See
   *  externalAppPolicy.ts. */
  sandbox?: readonly SandboxOption[];
  /** Browser features delegated to the page through the iframe `allow`
   *  attribute (camera, clipboard, …) — OPTIONAL, absent = none. */
  allow?: readonly PermissionOption[];
  /** SESSION-ONLY entry set by an embedding host through the postMessage API
   *  (`externalApps.set`): never persisted to localStorage and not editable in
   *  Settings — gone on reload until the host sets it again after app.ready. */
  hostManaged?: boolean;
}

interface ExternalAppsState {
  apps: ExternalApp[];
}

const KEY = storageKey('externalApps');

function load(): ExternalAppsState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return { apps: [] };
    }
    const saved = JSON.parse(raw) as Partial<ExternalAppsState>;
    const apps = Array.isArray(saved.apps) ? saved.apps : [];
    // older saves miss the section/size/tooltip fields — fill defaults
    return {
      apps: apps.map((a) => ({
        ...a,
        section: typeof a.section === 'string' ? a.section : '',
        size: a.size === 'big' || a.size === 'small' ? a.size : 'medium',
        tooltip: typeof a.tooltip === 'string' ? a.tooltip : '',
        newWindow: a.newWindow === true,
        openOnStart: a.openOnStart === true,
        home: a.home === true,
        homeAt: a.homeAt === 'end' ? 'end' : 'start',
        modal: a.modal === true,
        config: typeof a.config === 'string' ? a.config : '',
        // policy lists are optional — unknown values from an older/newer save are dropped
        sandbox: readSandboxOptions(a.sandbox).list,
        allow: readPermissionOptions(a.allow).list,
      })),
    };
  } catch {
    return { apps: [] };
  }
}

export const externalAppsState = createStore<ExternalAppsState>(load());

externalAppsState.subscribe(() => {
  try {
    // host-managed entries are session-only — never persisted
    const apps = externalAppsState.get().apps.filter((a) => !a.hostManaged);
    localStorage.setItem(KEY, JSON.stringify({ apps }));
  } catch {
    // storage unavailable — non-fatal
  }
});

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const externalAppsActions = {
  add(preset?: Partial<Omit<ExternalApp, 'id'>>) {
    externalAppsState.set((s) => ({
      apps: [
        ...s.apps,
        {
          id: newId(),
          name: '',
          url: '',
          multiple: false,
          section: '',
          size: 'medium',
          tooltip: '',
          newWindow: false,
          openOnStart: false,
          home: false,
          homeAt: 'start',
          modal: false,
          config: '',
          sandbox: [],
          allow: [],
          ...preset,
        },
      ],
    }));
  },
  /** Preset: the bundled API demo, dialog-hosted — a panel driving THIS viewer. */
  addDemoDialog() {
    externalAppsActions.add({
      name: 'Dialog',
      url: new URL('demo/?dialog=1', document.baseURI).href,
      section: 'Demo',
      size: 'big',
      tooltip: 'postMessage API demo hosted as a panel — drives this viewer',
    });
  },
  /** Preset: the bundled API demo in a new browser tab (embeds its own viewer). */
  addDemoTab() {
    externalAppsActions.add({
      name: 'Tab',
      url: new URL('demo/', document.baseURI).href,
      section: 'Demo',
      size: 'big',
      tooltip: 'postMessage API demo in a new tab — embeds a viewer in an iframe',
      newWindow: true,
    });
  },
  /** Add both bundled demo entries at once (Dialog panel + Tab). */
  addDemos() {
    externalAppsActions.addDemoDialog();
    externalAppsActions.addDemoTab();
  },
  update(id: string, patch: Partial<Omit<ExternalApp, 'id'>>) {
    externalAppsState.set((s) => ({ apps: s.apps.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  },
  remove(id: string) {
    externalAppsState.set((s) => ({ apps: s.apps.filter((a) => a.id !== id) }));
  },
  /** Remove every configured external app (host-managed entries stay — they
   *  belong to the embedding host's session, not the user's settings). */
  clearAll() {
    externalAppsState.set((s) => ({ apps: s.apps.filter((a) => a.hostManaged) }));
  },

  /** Declaratively replace the SESSION-ONLY host-managed set (postMessage
   *  `externalApps.set`): all prior host entries go, the given ones come in.
   *  An entry that brings its own `id` keeps it across calls, so it is the
   *  SAME app to everything that references it — its open panels and dialogs
   *  stay attached while the button / tooltip / config update. User-configured
   *  entries are untouched. Returns the created entries. */
  setHostManaged(apps: (Omit<ExternalApp, 'id' | 'hostManaged'> & { id?: string })[]): ExternalApp[] {
    const created = apps.map((a) => ({ ...a, id: a.id ?? newId(), hostManaged: true as const }));
    externalAppsState.set((s) => ({ apps: [...s.apps.filter((a) => !a.hostManaged), ...created] }));
    return created;
  },
};

// -----------------------------------------------------------------------------
// opener hook — App startup owns the dock manager and registers how to open an
// app as a panel/modal, so the postMessage handler can honour `openOnStart`
// -----------------------------------------------------------------------------

/** What opening an app as a panel or modal yields: the id the `ui.dialog.*`
 *  commands address it by, and the `?tdsDialogId=` its page sees. */
export interface OpenedExternalApp {
  dialogId: string;
  tdsDialogId: string;
}

let opener: ((app: ExternalApp) => OpenedExternalApp | null) | null = null;

export function registerExternalAppOpener(fn: (app: ExternalApp) => OpenedExternalApp | null) {
  opener = fn;
}

/** Open an app as its panel/modal NOW (used for host-set `openOnStart`
 *  entries). New-window apps are skipped — window.open without a user gesture
 *  is popup-blocked. No-op before the dock manager registers the opener. */
export function openExternalAppNow(app: ExternalApp): { opened: boolean } & Partial<OpenedExternalApp> {
  if (!opener || app.newWindow || !app.name.trim() || !app.url.trim()) {
    return { opened: false };
  }
  return { opened: true, ...opener(app) };
}

/** The app's URL with its JSON config attached as a `?config=` param (the
 *  value is the config MINIFIED — parse errors fall back to the raw text) and,
 *  for a panel / dialog instance, its `?tdsDialogId=` identity (see
 *  externalDialogIds.ts). */
export function externalAppUrl(a: ExternalApp, tdsDialogId?: string): string {
  const cfg = a.config.trim();
  if (!cfg && !tdsDialogId) {
    return a.url;
  }
  let value = cfg;
  try {
    value = JSON.stringify(JSON.parse(cfg));
  } catch {
    // not valid JSON (yet) — send the raw text so the page can still see it
  }
  try {
    const u = new URL(a.url, location.href);
    if (cfg) {
      u.searchParams.set('config', value);
    }
    if (tdsDialogId) {
      u.searchParams.set('tdsDialogId', tdsDialogId);
    }
    return u.href;
  } catch {
    return a.url;
  }
}

/** Origins of every configured app (for the postMessage allowlist). */
export function externalAppOrigins(): string[] {
  const out: string[] = [];
  for (const a of externalAppsState.get().apps) {
    try {
      const o = new URL(a.url, location.href).origin;
      if (o && o !== 'null' && !out.includes(o)) {
        out.push(o);
      }
    } catch {
      // incomplete url while typing — ignore
    }
  }
  return out;
}
