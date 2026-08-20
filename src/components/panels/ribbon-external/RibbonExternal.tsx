// External ribbon: one button per configured external app (Settings →
// External). Opens the app's URL as an iframe panel; apps flagged `multiple`
// spawn a fresh panel per click. Hosted tools can drive the viewer through
// the postMessage API — see EVENTS.md.
import { IconWorld } from '@tabler/icons-react';
import { usePanelContext } from '@treDeSpaceUI/dockable';
import { Ribbon, RibbonButton, RibbonSection, type RibbonSize } from '@treDeSpaceUI/widgets';
import { type ExternalApp, externalAppsState, externalAppUrl } from '../../../state/externalApps.state';
import { openExternalModal } from './externalModals.state';
import { externalPanelId, makeExternalPanel } from './externalPanels';

// the state's "small" is the ribbon's "mini" (3 stacked per column)
const RIBBON_SIZE: Record<ExternalApp['size'], RibbonSize> = { big: 'big', medium: 'medium', small: 'mini' };

/** One ribbon button per configured external app, grouped by ribbon section. */
export function RibbonExternal() {
  const { manager } = usePanelContext();
  const { apps } = externalAppsState.use();
  const usable = apps.filter((a) => a.name.trim() && a.url.trim());
  let counter = 0;

  // group by section, keeping first-appearance order; empty section → default
  const sections: { title: string; apps: ExternalApp[] }[] = [];
  for (const a of usable) {
    const title = a.section.trim() || 'External apps';
    const found = sections.find((s) => s.title === title);
    if (found) {
      found.apps.push(a);
    } else {
      sections.push({ title, apps: [a] });
    }
  }

  return (
    <Ribbon>
      {sections.length === 0 && (
        <RibbonSection title="External apps">
          <RibbonButton
            size="big"
            label="Configure…"
            tooltip="Add external app URLs under Settings → External"
            disabled
            onClick={() => {}}
          />
        </RibbonSection>
      )}
      {sections.map((s) => (
        <RibbonSection key={s.title} title={s.title}>
          {s.apps.map((a) => (
            <RibbonButton
              key={a.id}
              size={RIBBON_SIZE[a.size]}
              className={a.size === 'big' ? '' : 'min-w-28'}
              icon={<IconWorld />}
              label={a.name}
              tooltip={
                a.tooltip.trim() ||
                (a.newWindow
                  ? `Open ${a.url} in a new browser tab`
                  : a.modal
                    ? `Open ${a.url} as a modal dialog`
                    : `Open ${a.url} as a panel${a.multiple ? ' (a new instance per click)' : ''}`)
              }
              onClick={() => {
                if (a.newWindow) {
                  window.open(externalAppUrl(a), '_blank', 'noopener');
                  return;
                }
                if (a.modal) {
                  openExternalModal(a);
                  return;
                }
                const id = a.multiple
                  ? `${externalPanelId(a.id)}:${Date.now().toString(36)}${counter++}`
                  : externalPanelId(a.id);
                manager.registerPanel(makeExternalPanel(id, a.name, externalAppUrl(a)));
                manager.openPanel(id);
              }}
            />
          ))}
        </RibbonSection>
      ))}
    </Ribbon>
  );
}
