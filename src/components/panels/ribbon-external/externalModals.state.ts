// State for the modal external dialogs (Settings → External → "Modal
// dialog"): which app iframes are open, plus their initial size parsed from
// the app's config JSON: {"width": "600px", "height": "60%"} — px or % (of
// the viewport), a number means px; default 70% × 70%.
import { createStore } from '@treDeSpaceUI/lib/createStore';
import { externalAppIframePolicy, type IframePolicy } from '../../../state/externalAppPolicy';
import { type ExternalApp, externalAppUrl } from '../../../state/externalApps.state';
import { beginHeldClose, clearCloseHold } from '../../../state/externalCloseHold';
import { dialogIdFor, freshDialogId } from '../../../state/externalDialogIds';

export interface OpenModal {
  /** Instance id — the dialog id the postMessage API addresses it by. */
  key: string;
  /** The `?tdsDialogId=` on the page's URL: stable per app for a
   *  single-instance dialog (close → reopen gets the same one), fresh per
   *  open for a multi-instance one. */
  tdsDialogId: string;
  appId: string;
  name: string;
  url: string;
  /** The iframe's sandbox / allow attributes, resolved from the app at open time. */
  policy: IframePolicy;
  width: string;
  height: string;
  /** Hidden but STILL MOUNTED: the iframe keeps running and keeps its state,
   *  so showing it again resumes the same page (unlike closing, which drops
   *  the context). Driven by the host through `ui.dialog.hide` / `.show`. */
  hidden?: boolean;
  /** Hidden for a deferred close: the page asked to be told first
   *  (`ui.dialog.holdClose`) and is flushing state; unmounted once it releases
   *  the hold or the timeout passes. */
  closing?: boolean;
}

export const externalModalsState = createStore<{ open: OpenModal[] }>({ open: [] });
let seq = 0;

/** "600px" / "60%" / 600 → CSS length; anything else → null. */
function dim(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return `${v}px`;
  }
  if (typeof v === 'string' && /^\d+(\.\d+)?(px|%)$/.test(v.trim())) {
    return v.trim();
  }
  return null;
}

function initialSize(config: string): { width: string; height: string } {
  const fallback = { width: '70%', height: '70%' };
  try {
    const c = JSON.parse(config) as Record<string, unknown>;
    return { width: dim(c.width) ?? fallback.width, height: dim(c.height) ?? fallback.height };
  } catch {
    return fallback;
  }
}

/** Open an external app as a modal dialog (single-instance apps re-focus the
 *  existing dialog instead of opening a second one). Returns the dialog id —
 *  what `ui.dialog.hide` / `.show` / `.close` address it by. A hidden
 *  single-instance dialog is un-hidden rather than duplicated. */
export function openExternalModal(app: ExternalApp): string {
  let key = '';
  externalModalsState.set((s) => {
    // single-instance apps: re-opening brings the existing dialog to the top
    const existing = !app.multiple ? s.open.find((m) => m.appId === app.id && !m.closing) : undefined;
    if (existing) {
      key = existing.key;
      const shown = { ...existing, hidden: false };
      return { open: [...s.open.filter((m) => m.key !== existing.key), shown] };
    }
    const size = initialSize(app.config);
    key = `${app.id}:${seq++}`;
    const tdsDialogId = app.multiple ? freshDialogId() : dialogIdFor(`modal:${app.id}`);
    return {
      open: [
        ...s.open,
        {
          key,
          tdsDialogId,
          appId: app.id,
          name: app.name,
          url: externalAppUrl(app, tdsDialogId),
          policy: externalAppIframePolicy(app),
          ...size,
        },
      ],
    };
  });
  return key;
}

/** Hide or re-show one modal WITHOUT unmounting it — the iframe keeps its
 *  context (a half-filled form, a live session) across the round trip.
 *  Returns false when no dialog has that id. */
export function setExternalModalHidden(key: string, hidden: boolean): boolean {
  const target = externalModalsState.get().open.find((m) => m.key === key);
  if (!target || target.closing) {
    return false;
  }
  const next = { ...target, hidden };
  // re-showing also raises it: render order is the stacking order
  externalModalsState.set((s) => {
    const rest = s.open.filter((m) => m.key !== key);
    return { open: hidden ? [next, ...rest] : [...rest, next] };
  });
  return true;
}

/** Close one external modal dialog by its instance key. A page that asked to
 *  be told first (`ui.dialog.holdClose`) gets `dialog.changed: closing` and a
 *  moment to flush state: the dialog is hidden at once and unmounted when the
 *  page releases the hold or the timeout passes. */
export function closeExternalModal(key: string) {
  const target = externalModalsState.get().open.find((m) => m.key === key);
  if (!target || target.closing) {
    return;
  }
  const wait = beginHeldClose(key);
  if (!wait) {
    removeExternalModal(key);
    return;
  }
  externalModalsState.set((s) => ({ open: s.open.map((m) => (m.key === key ? { ...m, closing: true } : m)) }));
  void wait.then(() => removeExternalModal(key));
}

function removeExternalModal(key: string) {
  externalModalsState.set((s) => ({ open: s.open.filter((m) => m.key !== key) }));
  clearCloseHold(key);
}

/** Retitle one open dialog — its title bar and the `name` that `ui.dialogs`
 *  reports; the app entry's own name (the ribbon button) is untouched.
 *  Returns false when no dialog has that key. */
export function renameExternalModal(key: string, name: string): boolean {
  if (!externalModalsState.get().open.some((m) => m.key === key)) {
    return false;
  }
  externalModalsState.set((s) => ({ open: s.open.map((m) => (m.key === key ? { ...m, name } : m)) }));
  return true;
}

/** The open dialog addressed by EITHER identity — its dialog id (`key`) or
 *  the `tdsDialogId` its page sees on its URL. Both are unique among the open
 *  dialogs (a single-instance app has at most one open, a multi-instance one
 *  gets a fresh id per open), so a page can address itself by the value it
 *  already has. */
export function findExternalModal(id: string): OpenModal | undefined {
  const open = externalModalsState.get().open;
  return (
    open.find((m) => m.key === id) ??
    open.find((m) => m.tdsDialogId === id && !m.closing) ??
    open.find((m) => m.tdsDialogId === id)
  );
}
