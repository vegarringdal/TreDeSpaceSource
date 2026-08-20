import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import { externalAppsActions, externalAppsState } from '../../../../state/externalApps.state';
import { dialogs } from '../../../dialogs/dialogs.actions';
import { ApiSecuritySection } from './ApiSecuritySection';
import { ExternalAppEditor } from './ExternalAppEditor';

/** Settings → External tab: external app entries + postMessage API security. */
export function ExternalTab() {
  // host-managed entries (postMessage externalApps.set) are session-only and
  // belong to the embedding page — not editable here
  const allApps = externalAppsState.use().apps;
  const externalApps = allApps.filter((a) => !a.hostManaged);
  const hostManagedCount = allApps.length - externalApps.length;

  return (
    <>
      <Collapsible
        title="External apps"
        info={
          <>
            URLs opened as iframe panels from the <b>External</b> ribbon. Hosted tools can drive the viewer through the
            postMessage API (see EVENTS.md) — their origins are allowed automatically. <b>Multiple</b> = a fresh panel
            instance per click. Apps sharing a <b>Section</b> are grouped together in the ribbon.
            <br />
            <br />
            The bundled demo page (drives the viewer through the API) is served at{' '}
            <code className="select-text">{new URL('demo/', document.baseURI).href}</code>. Add ready-made entries
            (section <b>Demo</b>): <b>Dialog</b> hosts it as a panel driving this viewer; <b>Tab</b> opens it in a new
            browser tab embedding its own viewer.
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            tooltip="Add an external app (name + URL)"
            shortcut="external.add"
            onClick={() => externalAppsActions.add()}
          >
            Add external app
          </Button>
          <Button
            disabled={externalApps.length === 0}
            tooltip="Remove ALL external apps (not touched by Reset all settings)"
            shortcut="external.reset"
            onClick={() =>
              void dialogs
                .confirm(`Remove all ${externalApps.length} external app(s)?`, { okLabel: 'Remove all' })
                .then((ok) => ok && externalAppsActions.clearAll())
            }
          >
            Reset external apps
          </Button>
          <Button
            tooltip="Add both bundled API demo entries: a Dialog panel driving this viewer and a Tab that embeds its own viewer"
            shortcut="external.demos"
            onClick={() => externalAppsActions.addDemos()}
          >
            Add Demos
          </Button>
        </div>
        {externalApps.map((a) => (
          <ExternalAppEditor key={a.id} app={a} />
        ))}
        <div className="text-slate-500 text-xs">
          New entries appear in the External ribbon once they have a name and URL. Reload to register restored panels
          after URL changes.
          {hostManagedCount > 0 && (
            <>
              {' '}
              {hostManagedCount} additional app(s) are set by the embedding page for this session (not editable here).
            </>
          )}
        </div>
      </Collapsible>
      <ApiSecuritySection />
    </>
  );
}
