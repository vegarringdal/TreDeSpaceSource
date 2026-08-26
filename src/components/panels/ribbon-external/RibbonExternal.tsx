// External ribbon: one button per configured external app (Settings →
// External). Apps flagged "Show in Home" live on the Home ribbon instead.
// Hosted tools can drive the viewer through the postMessage API — see
// EVENTS.md.
import { Ribbon, RibbonButton, RibbonSection } from '@treDeSpaceUI/widgets';
import { externalAppsState } from '../../../state/externalApps.state';
import { ExternalAppButton, groupAppsBySection, usableApps } from './ExternalAppButton';

/** One ribbon button per configured external app, grouped by ribbon section. */
export function RibbonExternal() {
  const { apps } = externalAppsState.use();
  const sections = groupAppsBySection(usableApps(apps, 'external'), 'External apps');

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
            <ExternalAppButton key={a.id} app={a} />
          ))}
        </RibbonSection>
      ))}
    </Ribbon>
  );
}
