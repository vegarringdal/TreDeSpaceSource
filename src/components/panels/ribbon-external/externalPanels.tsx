import { definePanel } from '@treDeSpaceUI/dockable';
import { externalAppsState, externalAppUrl } from '../../../state/externalApps.state';

/** Iframe panel body for one external app URL. */
export function makeExternalPanel(id: string, title: string, url: string) {
  return definePanel({
    id,
    title,
    home: 'right',
    component: () => (
      <iframe
        title={title}
        src={url}
        className="h-full w-full border-0 bg-white"
        // no top-navigation / popups: the tool lives inside its panel
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
      />
    ),
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
    manager.registerPanel(makeExternalPanel(externalPanelId(a.id), a.name, externalAppUrl(a)));
  }
  const restored = JSON.stringify(manager.saveLayout()).match(/"ext:[^"]+"/g) ?? [];
  for (const quoted of new Set(restored)) {
    const id = quoted.slice(1, -1);
    const appId = id.slice(4).split(':')[0];
    const a = apps.find((x) => x.id === appId);
    if (a && id !== externalPanelId(a.id)) {
      manager.registerPanel(makeExternalPanel(id, a.name, externalAppUrl(a)));
    }
  }
}
