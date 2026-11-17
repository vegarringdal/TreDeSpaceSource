// The windows the postMessage API has heard from — each with an id the APP
// assigns (a client-chosen id could impersonate another window) — and the
// custom-event bus between them (custom.*): subscriptions, targeted delivery
// and the presence event. Identity is the sending window; a reloaded page is
// a new client. Also each client's app-event subscription and the owner of
// an in-flight batch, which is where transport.ts routes app events.
import { isLifecycleEvent } from './apiEvents';
import { PROTOCOL } from './wire';

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
  /** custom-bus filter: subscribed event names; null = every event, [] = presence only */
  events: string[] | null;
  /** app-event filter (`events.subscribe`): null = everything (a client that
   *  never subscribed — hand-rolled hosts), else exactly these; `app.*`
   *  lifecycle events always go through. */
  appEvents: Set<string> | null;
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
    appEvents: null,
  };
  byWindow.set(win, entry);
  entries.push(entry);
  return entry;
}

export function clientOf(win: Window | null | undefined): ClientEntry | null {
  return win ? (byWindow.get(win) ?? null) : null;
}

export function isKnownClient(win: Window): boolean {
  return byWindow.has(win);
}

/** Every registered client whose window is still open (prunes the rest). */
export function liveClients(): ClientEntry[] {
  if (prune()) {
    emitClientsChanged();
  }
  return [...entries];
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

/**
 * Forget every client hosted by one dialog — an external panel or a modal —
 * because its iframe is going away. A removed iframe does NOT set
 * `Window.closed`, so `prune` never catches it and the entry (a strong
 * `Window` reference, plus its bus subscription) would live as long as the tab.
 */
export function dropClientsForDialog(dialogId: string): void {
  for (const e of entries.filter((x) => x.info.dialog === dialogId)) {
    dropClient(e.win);
  }
}

export function listClients(): ClientInfo[] {
  if (prune()) {
    emitClientsChanged();
  }
  return entries.map((e) => ({ ...e.info }));
}

// -----------------------------------------------------------------------------
// app events: per-client subscription + batch ownership
// -----------------------------------------------------------------------------

/** Add event types to a client's app-event subscription. The first call
 *  turns the client from "everything" into "exactly these" (an empty list
 *  keeps only `app.*`); later calls add, never replace — a relayed window's
 *  subscription arrives under its relaying client and must not wipe it.
 *  Returns the subscription as it now stands. */
export function subscribeAppEvents(e: ClientEntry, names: readonly string[]): string[] {
  e.appEvents = new Set([...(e.appEvents ?? []), ...names]);
  return [...e.appEvents].sort();
}

export function wantsAppEvent(e: ClientEntry, type: string): boolean {
  return isLifecycleEvent(type) || e.appEvents === null || e.appEvents.has(type);
}

const batchOwners = new Map<string, Window>();

/** A command carrying a `batchId` owns that batch for its duration: its
 *  progress events go to this window alone. */
export function noteBatchOwner(batchId: string, win: Window): void {
  batchOwners.set(batchId, win);
}

export function forgetBatchOwner(batchId: string): void {
  batchOwners.delete(batchId);
}

export function batchOwnerClient(batchId: string): ClientEntry | null {
  const win = batchOwners.get(batchId);
  return win ? (byWindow.get(win) ?? null) : null;
}

// -----------------------------------------------------------------------------
// the bus
// -----------------------------------------------------------------------------

/** One unsolicited message to one client, at its exact origin. */
export function postToClient(e: ClientEntry, type: string, payload: unknown): void {
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
      postToClient(e, 'custom.clients.changed', { clients });
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
    postToClient(e, 'custom.event', payload);
    hit.add(e.info.id);
  }
  return { delivered: hit.size, missed: to ? to.filter((id) => !hit.has(id)) : [] };
}
