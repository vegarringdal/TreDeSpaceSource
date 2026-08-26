// External apps promoted to the HOME ribbon (Settings → External → "Show in
// Home"), so a tool the user needs immediately — a project selector, a report
// picker — is on the tab the app opens on instead of one tab over.
import { RibbonSection } from '@treDeSpaceUI/widgets';
import { externalAppsState, type HomePlacement } from '../../../state/externalApps.state';
import { ExternalAppButton, groupAppsBySection, usableApps } from '../ribbon-external/ExternalAppButton';

/** Home-ribbon sections for external apps flagged `home`, for one END of the
 *  ribbon (the Home ribbon renders this twice: before and after its own
 *  groups). Renders nothing when none sit there — the ribbon must not grow an
 *  empty section. */
export function HomeExternalGroup({ at }: { at: HomePlacement }) {
  const { apps } = externalAppsState.use();
  const here = usableApps(apps, 'home').filter((a) => (a.homeAt === 'end' ? 'end' : 'start') === at);
  const sections = groupAppsBySection(here, 'Tools');

  return (
    <>
      {sections.map((s) => (
        <RibbonSection key={s.title} title={s.title}>
          {s.apps.map((a) => (
            <ExternalAppButton key={a.id} app={a} />
          ))}
        </RibbonSection>
      ))}
    </>
  );
}
