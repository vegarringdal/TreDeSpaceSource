import { definePanel } from '@treDeSpaceUI/dockable';
import { externalAppIframePolicy } from '../../../state/externalAppPolicy';
import { type ExternalApp, externalAppsState, externalAppUrl } from '../../../state/externalApps.state';
import { beginHeldClose } from '../../../state/externalCloseHold';
import { dialogIdFor } from '../../../state/externalDialogIds';
import { externalPanelsActions } from '../../../state/externalPanels/externalPanels.actions';
import type { OpenPanel } from '../../../state/externalPanels/externalPanels.state';
import { ExternalPanelBody } from './ExternalPanelBody';

/** Iframe panel for one external app: its URL (with `?config=` and the
 *  panel's stable `?tdsDialogId=`) and its per-app sandbox / allow policy (the
 *  base policy unless the app opted into more — see externalAppPolicy.ts). */
export function makeExternalPanel(id: string, app: ExternalApp) {
  const tdsDialogId = dialogIdFor(id);
  const entry: OpenPanel = {
    key: id,
    tdsDialogId,
    appId: app.id,
    name: app.name,
    url: externalAppUrl(app, tdsDialogId),
  };
  const policy = externalAppIframePolicy(app);
  return definePanel({
    id,
    title: app.name,
    home: 'right',
    // a page that asked to be told first (ui.dialog.holdClose) gets
    // `dialog.changed: closing` and a moment to flush state before its iframe
    // is unmounted; the tab disappears at once either way
    beforeClose: () => {
      const wait = beginHeldClose(id);
      if (wait) {
        externalPanelsActions.closing(id);
      }
      return wait ?? undefined;
    },
    component: () => <ExternalPanelBody entry={entry} policy={policy} />,
  });
}

/** Deterministic panel id for single-instance apps — layout restore finds it. */
export const externalPanelId = (appId: string) => `ext:${appId}`;

// multi-instance panels need a fresh id per open — shared by the ribbon button
// and the API opener, and unique against ids restored from a saved layout
let instanceSeq = 0;

/** The panel id for one more open of `app`: the stable `ext:<appId>` for a
 *  single-instance app, a fresh `ext:<appId>:<suffix>` for a `multiple` one. */
export function newExternalPanelId(app: ExternalApp): string {
  if (!app.multiple) {
    return externalPanelId(app.id);
  }
  return `${externalPanelId(app.id)}:${Date.now().toString(36)}${(instanceSeq++).toString(36)}`;
}

/** Boot-time registration so a restored layout renders external panels:
 *  single-instance ids (`ext:<appId>`) always; multi-instance ids
 *  (`ext:<appId>:<suffix>`) are recovered by scanning the restored layout —
 *  any surviving id whose app still exists gets a def with the same id. */
export function registerExternalPanels(manager: {
  registerPanel(def: ReturnType<typeof definePanel>): void;
  saveLayout(): unknown;
}) {
  const apps = externalAppsState.get().apps.filter((a) => a.name.trim() && a.url.trim() && !a.newWindow && !a.modal);
  for (const a of apps) {
    manager.registerPanel(makeExternalPanel(externalPanelId(a.id), a));
  }
  const restored = JSON.stringify(manager.saveLayout()).match(/"ext:[^"]+"/g) ?? [];
  for (const quoted of new Set(restored)) {
    const id = quoted.slice(1, -1);
    const appId = id.slice(4).split(':')[0];
    const a = apps.find((x) => x.id === appId);
    if (a && id !== externalPanelId(a.id)) {
      manager.registerPanel(makeExternalPanel(id, a));
    }
  }
}
