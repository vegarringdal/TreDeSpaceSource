import { externalPanelsState, type OpenPanel } from './externalPanels.state';

export const externalPanelsActions = {
  /** The panel body mounted — its page is alive. A second mount of the same
   *  id (StrictMode in dev) is a no-op. */
  open(entry: OpenPanel) {
    externalPanelsState.set((s) => (s.open.some((p) => p.key === entry.key) ? {} : { open: [...s.open, entry] }));
  },

  /** A deferred close began: the tab is gone, the page flushing state. */
  closing(key: string) {
    externalPanelsState.set((s) => ({ open: s.open.map((p) => (p.key === key ? { ...p, closing: true } : p)) }));
  },

  /** `ui.close` / `ui.dialog.close` with `remove: true`: when this panel's
   *  close completes, forget it entirely (see externalPanels.tsx). */
  markRemove(key: string) {
    externalPanelsState.set((s) => ({ open: s.open.map((p) => (p.key === key ? { ...p, remove: true } : p)) }));
  },

  /** The panel body unmounted — its page is gone, whatever closed it. */
  close(key: string) {
    externalPanelsState.set((s) => ({ open: s.open.filter((p) => p.key !== key) }));
  },

  /** Retitle one open panel's tab (and the `name` that `ui.dialogs` reports);
   *  the app entry's own name is untouched. Returns false when no panel has
   *  that key. */
  rename(key: string, name: string): boolean {
    if (!externalPanelsState.get().open.some((p) => p.key === key)) {
      return false;
    }
    externalPanelsState.set((s) => ({ open: s.open.map((p) => (p.key === key ? { ...p, name } : p)) }));
    return true;
  },
};

/** The open panel addressed by EITHER identity — its panel id or the
 *  `tdsDialogId` its page sees on its URL (the panel twin of
 *  findExternalModal). */
export function findExternalPanel(id: string): OpenPanel | undefined {
  const open = externalPanelsState.get().open;
  return (
    open.find((p) => p.key === id) ??
    open.find((p) => p.tdsDialogId === id && !p.closing) ??
    open.find((p) => p.tdsDialogId === id)
  );
}
