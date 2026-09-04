// `dialog.changed` payloads: the set of open external modal dialogs and
// external-app dock panels is diffed against its previous snapshot, so every
// route that opens, hides, shows, renames or closes one (the ribbon button,
// the ✕, `ui.close`, `ui.dialog.*`, `externalApps.set`, a layout swap) reports
// the same way. Pure — handlersUi.ts wires it to the stores and the
// transport — so it is unit-tested as is.

/** What happened to one dialog. `hidden` / `shown` are the `ui.dialog.hide` /
 *  `.show` round trip (the page stays mounted; modal dialogs only); `closed`
 *  means unmounted. */
export type DialogChangeState = 'opened' | 'hidden' | 'shown' | 'renamed' | 'closed';

/** A modal dialog over the viewer, or an external-app dock panel. */
export type DialogKind = 'dialog' | 'panel';

/** The fields of an open external modal / panel the diff looks at —
 *  structurally `OpenModal` / `OpenPanel` plus `kind`. */
export interface DialogSnapshot {
  kind: DialogKind;
  key: string;
  tdsDialogId: string;
  appId: string;
  name: string;
  url: string;
  hidden?: boolean;
}

/** One `dialog.changed` event: the dialog as `ui.dialogs` lists it, plus what
 *  changed. A `closed` entry carries the dialog's last known fields. */
export interface DialogChange {
  state: DialogChangeState;
  kind: DialogKind;
  id: string;
  tdsDialogId: string;
  appId: string;
  name: string;
  url: string;
  hidden: boolean;
}

function change(state: DialogChangeState, m: DialogSnapshot): DialogChange {
  return {
    state,
    kind: m.kind,
    id: m.key,
    tdsDialogId: m.tdsDialogId,
    appId: m.appId,
    name: m.name,
    url: m.url,
    hidden: m.hidden === true,
  };
}

/**
 * The changes that turn `prev` into `next`, matched by dialog id: closed
 * dialogs first, then hidden/shown and renamed ones (one dialog can report
 * both in a single step), then newly opened ones. Reordering (a raise) is
 * not a change.
 */
export function diffDialogChanges(prev: readonly DialogSnapshot[], next: readonly DialogSnapshot[]): DialogChange[] {
  const out: DialogChange[] = [];
  const nextByKey = new Map(next.map((m) => [m.key, m]));
  for (const before of prev) {
    const after = nextByKey.get(before.key);
    if (!after) {
      out.push(change('closed', before));
      continue;
    }
    if ((before.hidden === true) !== (after.hidden === true)) {
      out.push(change(after.hidden === true ? 'hidden' : 'shown', after));
    }
    if (before.name !== after.name) {
      out.push(change('renamed', after));
    }
  }
  const prevKeys = new Set(prev.map((m) => m.key));
  for (const m of next) {
    if (!prevKeys.has(m.key)) {
      out.push(change('opened', m));
    }
  }
  return out;
}
