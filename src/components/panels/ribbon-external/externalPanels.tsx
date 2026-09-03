import { definePanel } from '@treDeSpaceUI/dockable';
import { externalAppIframePolicy } from '../../../state/externalAppPolicy';
import { type ExternalApp, externalAppsState, externalAppUrl } from '../../../state/externalApps.state';

/** Iframe panel body for one external app: its URL (with `?config=`) and its
 *  per-app sandbox / allow policy (the base policy unless the app opted into
 *  more — see externalAppPolicy.ts). */
export function makeExternalPanel(id: string, app: ExternalApp) {
  const url = externalAppUrl(app);
  const policy = externalAppIframePolicy(app);
  return definePanel({
    id,
    title: app.name,
    home: 'right',
    component: () => (
      <iframe
        title={app.name}
        src={url}
        className="h-full w-full border-0 bg-white"
        // never top-navigation: the tool lives inside its panel
        sandbox={policy.sandbox}
        allow={policy.allow}
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
