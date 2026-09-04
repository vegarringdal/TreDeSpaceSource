import { definePanel, usePanelTitle } from '@treDeSpaceUI/dockable';
import { useEffect } from 'react';
import { externalAppIframePolicy, type IframePolicy } from '../../../state/externalAppPolicy';
import { type ExternalApp, externalAppsState, externalAppUrl } from '../../../state/externalApps.state';
import { dialogIdFor } from '../../../state/externalDialogIds';
import { externalPanelsActions } from '../../../state/externalPanels/externalPanels.actions';
import { externalPanelsState, type OpenPanel } from '../../../state/externalPanels/externalPanels.state';

/** The tab title while the panel is open: what `ui.dialog.rename` set, else
 *  the app entry's name. */
function useExternalPanelTitle(entry: OpenPanel): string {
  const { open } = externalPanelsState.use();
  return open.find((p) => p.key === entry.key)?.name ?? entry.name;
}

/** The iframe plus the panel's lifecycle: mounted = open (the page is alive),
 *  unmounted = closed — by the tab ✕, `ui.dialog.close`, `ui.close` or a
 *  layout swap that drops the panel — so `ui.dialogs` and `dialog.changed`
 *  follow exactly the page's lifetime. */
function ExternalPanelBody({ entry, policy }: { entry: OpenPanel; policy: IframePolicy }) {
  const title = useExternalPanelTitle(entry);
  usePanelTitle(title);

  useEffect(() => {
    externalPanelsActions.open(entry);
    return () => externalPanelsActions.close(entry.key);
  }, [entry]);

  return (
    <iframe
      title={title}
      src={entry.url}
      className="h-full w-full border-0 bg-white"
      // never top-navigation: the tool lives inside its panel
      sandbox={policy.sandbox}
      allow={policy.allow}
    />
  );
}

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
    component: () => <ExternalPanelBody entry={entry} policy={policy} />,
  });
}

/** Deterministic panel id for single-instance apps — layout restore finds it. */
export const externalPanelId = (appId: string) => `ext:${appId}`;

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
