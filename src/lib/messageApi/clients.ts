// The windows the postMessage API has heard from — each with an id the APP
// assigns (a client-chosen id could impersonate another window) — and the
// custom-event bus between them (custom.*): subscriptions, targeted delivery
// and the presence event. Identity is the sending window; a reloaded page is
// a new client.
import { PROTOCOL } from './protocol';

// -----------------------------------------------------------------------------
// types
// -----------------------------------------------------------------------------

export type ClientKind = 'parent' | 'opener' | 'panel' | 'window';

/** What other pages learn about a client (mirrors the SDK's ClientInfo). */
export interface ClientInfo {
  id: string;
  origin: string;
  kind: ClientKind;
  /** the `ui.dialogs` id of the panel / modal hosting a `panel` client */
  dialog?: string;
  /** chosen by the client at subscribe time */
  name?: string;
  /** free-form label chosen at subscribe time (a role, a version …) */
  tag?: string;
  subscribed: boolean;
}

export interface ClientEntry {
  readonly win: Window;
  readonly info: ClientInfo;
  /** subscribed event names; null = every event, [] = presence only */
  events: string[] | null;
}

// -----------------------------------------------------------------------------
// registry
// -----------------------------------------------------------------------------

const byWindow = new WeakMap<Window, ClientEntry>();
const entries: ClientEntry[] = [];
let nextId = 1;

type ClientGoneListener = (win: Window) => void;
const goneListeners: ClientGoneListener[] = [];

/** Run `cb` whenever a client window is forgotten — it said `client.bye` or
 *  was found closed — the hook for state a window owns, like an upload
 *  session, so nothing outlives the page that started it. */
export function onClientGone(cb: ClientGoneListener): void {
  goneListeners.push(cb);
}

function notifyGone(win: Window): void {
  for (const cb of goneListeners) {
    cb(win);
  }
}

/** The `ui.dialogs` id of the external-app panel or modal whose iframe is
 *  `win`, or null when the window is not one of ours. */
export function panelIdOfWindow(win: Window | null | undefined): string | null {
  if (!win) {
    return null;
  }
  for (const f of document.querySelectorAll('iframe')) {
    if (f.contentWindow === win) {
      return (
        f.closest('[data-ext-modal]')?.getAttribute('data-ext-modal') ??
        f.closest('[data-panel]')?.getAttribute('data-panel') ??
        null
      );
    }
  }
  return null;
}

function kindOf(win: Window): Pick<ClientInfo, 'kind' | 'dialog'> {
  if (win !== window && win === window.parent) {
    return { kind: 'parent' };
  }
  if (window.opener && win === window.opener) {
    return { kind: 'opener' };
  }
  const dialog = panelIdOfWindow(win);
  if (dialog) {
    return { kind: 'panel', dialog };
  }
  return { kind: 'window' };
}

/** Drop entries whose window is gone (closed tab, removed iframe). Returns
 *  true when a SUBSCRIBED client went away, so the caller announces it. */
function prune(): boolean {
  let lostSubscriber = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.win.closed) {
      byWindow.delete(e.win);
      entries.splice(i, 1);
      lostSubscriber ||= e.info.subscribed;
      notifyGone(e.win);
    }
  }
  return lostSubscriber;
}

/** Get or register the client behind a sending window — every valid API
 *  message passes through here, so a page is known from its first hello. */
export function touchClient(win: Window, origin: string): ClientEntry {
  const cur = byWindow.get(win);
  if (cur) {
    return cur;
  }
  const entry: ClientEntry = {
    win,
    info: { id: `c${nextId++}`, origin, ...kindOf(win), subscribed: false },
    events: null,
  };
  byWindow.set(win, entry);
  entries.push(entry);
  return entry;
}

export function clientOf(win: Window | null | undefined): ClientEntry | null {
  return win ? (byWindow.get(win) ?? null) : null;
}

/** The SDK's client.bye (dispose / pagehide): forget the window now rather
 *  than at the next prune. */
export function dropClient(win: Window): void {
  const e = byWindow.get(win);
  if (!e) {
    return;
  }
  byWindow.delete(win);
  entries.splice(entries.indexOf(e), 1);
  notifyGone(win);
  if (e.info.subscribed) {
    emitClientsChanged();
  }
}

export function listClients(): ClientInfo[] {
  if (prune()) {
    emitClientsChanged();
  }
  return entries.map((e) => ({ ...e.info }));
}

// -----------------------------------------------------------------------------
// the bus
// -----------------------------------------------------------------------------

function post(e: ClientEntry, type: string, payload: unknown): void {
  try {
    e.win.postMessage(
      { tredespace: PROTOCOL, id: null, type, ok: true, payload },
      e.info.origin === 'null' ? '*' : e.info.origin,
    );
  } catch {
    // window gone between prune and post — the next prune drops it
  }
}

/** Presence: every subscriber gets the current client list. */
function emitClientsChanged(): void {
  prune();
  const clients = entries.map((e) => ({ ...e.info }));
  for (const e of entries) {
    if (e.info.subscribed) {
      post(e, 'custom.clients.changed', { clients });
    }
  }
}

/** A repeat subscribe replaces the name and filter — "the subscription is
 *  what you last asked for". */
export function subscribeClient(e: ClientEntry, label: { name?: string; tag?: string }, events: string[] | null): void {
  e.info.subscribed = true;
  if (label.name === undefined) {
    delete e.info.name;
  } else {
    e.info.name = label.name;
  }
  if (label.tag === undefined) {
    delete e.info.tag;
  } else {
    e.info.tag = label.tag;
  }
  e.events = events;
  emitClientsChanged();
}

export function unsubscribeClient(e: ClientEntry): void {
  if (!e.info.subscribed) {
    return;
  }
  e.info.subscribed = false;
  e.events = null;
  emitClientsChanged();
}

/** Post one custom event to the subscribers it is for: everyone but the
 *  sender when `to` is null, else exactly the named ids. A recipient's
 *  filter still applies. `missed` = named ids that did not receive it
 *  (unknown, not subscribed, filtered it out, or the sender itself). */
export function deliverCustomEvent(
  from: ClientEntry,
  event: string,
  data: unknown,
  to: string[] | null,
): { delivered: number; missed: string[] } {
  if (prune()) {
    emitClientsChanged();
  }
  const wanted = to ? new Set(to) : null;
  const payload = { event, data, from: { ...from.info }, to };
  const hit = new Set<string>();
  for (const e of entries) {
    if (e === from || !e.info.subscribed) {
      continue;
    }
    if (wanted && !wanted.has(e.info.id)) {
      continue;
    }
    if (e.events && !e.events.includes(event)) {
      continue;
    }
    post(e, 'custom.event', payload);
    hit.add(e.info.id);
  }
  return { delivered: hit.size, missed: to ? to.filter((id) => !hit.has(id)) : [] };
}
