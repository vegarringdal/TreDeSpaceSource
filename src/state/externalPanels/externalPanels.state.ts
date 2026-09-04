// The external-app DOCK PANELS whose iframe is mounted right now — the panel
// counterpart of externalModals.state.ts, so `ui.dialogs`, `dialog.changed`
// and `ui.dialog.rename` / `.close` see panels and modal dialogs alike.
// Entries come and go with the panel body's mount (externalPanels.tsx): the
// tab ✕, `ui.close`, `ui.dialog.close` and a layout swap that drops the panel
// all end its page the same way, and are all reported as `closed`.
import { createStore } from '@treDeSpaceUI/lib/createStore';

export interface OpenPanel {
  /** The dock panel id — `ext:<appId>`, or `ext:<appId>:<suffix>` for a
   *  multi-instance app — what the `ui.dialog.*` commands address it by. */
  key: string;
  /** The `?tdsDialogId=` on the page's URL — stable per panel id for the tab. */
  tdsDialogId: string;
  appId: string;
  /** The tab title: the app entry's name until `ui.dialog.rename` changes it. */
  name: string;
  url: string;
  /** Hidden for a deferred close (`ui.dialog.holdClose`): the tab is gone,
   *  the page still mounted and flushing state until it releases the hold or
   *  the timeout passes. */
  closing?: boolean;
}

export const externalPanelsState = createStore<{ open: OpenPanel[] }>({ open: [] });
