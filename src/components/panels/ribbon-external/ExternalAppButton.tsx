// One ribbon button for a configured external app. Shared by the External
// ribbon and the Home ribbon (apps flagged `home`), so both open an app the
// same way: new browser tab, modal dialog, or a docked iframe panel.
import { IconWorld } from '@tabler/icons-react';
import { usePanelContext } from '@treDeSpaceUI/dockable';
import { RibbonButton, type RibbonSize } from '@treDeSpaceUI/widgets';
import { type ExternalApp, externalAppUrl } from '../../../state/externalApps.state';
import { openExternalModal } from './externalModals.state';
import { externalPanelId, makeExternalPanel } from './externalPanels';

// the state's "small" is the ribbon's "mini" (3 stacked per column)
const RIBBON_SIZE: Record<ExternalApp['size'], RibbonSize> = { big: 'big', medium: 'medium', small: 'mini' };

// multi-instance panels need a fresh id per click; module-scoped so the
// counter survives re-renders and is shared across both ribbons
let instanceSeq = 0;

function defaultTooltip(a: ExternalApp): string {
  if (a.newWindow) {
    return `Open ${a.url} in a new browser tab`;
  }
  if (a.modal) {
    return `Open ${a.url} as a modal dialog`;
  }
  return `Open ${a.url} as a panel${a.multiple ? ' (a new instance per click)' : ''}`;
}

/** Ribbon button that opens one external app. */
export function ExternalAppButton({ app }: { app: ExternalApp }) {
  const { manager } = usePanelContext();

  const handleClick = () => {
    if (app.newWindow) {
      window.open(externalAppUrl(app), '_blank', 'noopener');
      return;
    }
    if (app.modal) {
      openExternalModal(app);
      return;
    }
    const id = app.multiple ? `${externalPanelId(app.id)}:${(instanceSeq++).toString(36)}` : externalPanelId(app.id);
    manager.registerPanel(makeExternalPanel(id, app));
    manager.openPanel(id);
  };

  return (
    <RibbonButton
      size={RIBBON_SIZE[app.size]}
      className={app.size === 'big' ? '' : 'min-w-28'}
      icon={<IconWorld />}
      label={app.name}
      tooltip={app.tooltip.trim() || defaultTooltip(app)}
      onClick={handleClick}
    />
  );
}

/** Group usable apps by their ribbon section, keeping first-appearance order.
 *  An app with no section lands under `fallbackTitle`. */
export function groupAppsBySection(
  apps: ExternalApp[],
  fallbackTitle: string,
): { title: string; apps: ExternalApp[] }[] {
  const sections: { title: string; apps: ExternalApp[] }[] = [];
  for (const a of apps) {
    const title = a.section.trim() || fallbackTitle;
    const found = sections.find((s) => s.title === title);
    if (found) {
      found.apps.push(a);
    } else {
      sections.push({ title, apps: [a] });
    }
  }
  return sections;
}

/** Configured apps that are usable (named + addressed), split by where their
 *  button belongs: the Home ribbon (`home`) or the External ribbon. */
export function usableApps(apps: ExternalApp[], where: 'home' | 'external'): ExternalApp[] {
  return apps.filter((a) => a.name.trim() && a.url.trim() && (where === 'home') === (a.home === true));
}
