import { usePanelContext, usePanelTitle } from '@treDeSpaceUI/dockable';
import { useEffect } from 'react';
import type { IframePolicy } from '../../../state/externalAppPolicy';
import { clearCloseHold } from '../../../state/externalCloseHold';
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
export function ExternalPanelBody({ entry, policy }: { entry: OpenPanel; policy: IframePolicy }) {
  const title = useExternalPanelTitle(entry);
  const { manager } = usePanelContext();
  usePanelTitle(title);

  useEffect(() => {
    externalPanelsActions.open(entry);
    return () => {
      // `remove: true` (ui.close / ui.dialog.close): the definition and the
      // remembered dock location go with the page — a closed tab of a
      // multi-instance app would otherwise linger unreachable in the manager
      const remove = externalPanelsState.get().open.find((p) => p.key === entry.key)?.remove === true;
      externalPanelsActions.close(entry.key);
      clearCloseHold(entry.key);
      if (remove) {
        manager.unregisterPanel(entry.key);
      }
    };
  }, [entry, manager]);

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
