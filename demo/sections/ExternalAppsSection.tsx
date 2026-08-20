import { Button } from '@treDeSpaceUI/widgets';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

/** Session-only host-managed external apps: set installs THIS demo page as a
 *  modal app in the viewer's External ribbon (openOnStart opens it right
 *  away); nothing persists — a viewer reload drops it until set again. */
export function ExternalAppsSection() {
  const { run, c } = useDemo();

  // this demo in dialog mode — the classic "app hosted inside the viewer"
  const demoDialogUrl = new URL('./?dialog=1', location.href).href;

  const sampleApps = [
    {
      name: 'Host demo',
      url: demoDialogUrl,
      section: 'Demo host',
      modal: true,
      openOnStart: true,
      tooltip: 'This demo page, installed by the host for this session',
      config: { width: '600px', height: '60%' },
    },
  ];

  return (
    <DemoSection
      title="External apps (host-managed)"
      info="A hosting page configures the viewer's External ribbon for its context — session-only: never persisted, not
        editable in Settings, gone on reload until the host sets them again after app.ready. Set installs THIS demo
        page as a modal app and opens it immediately (openOnStart)."
    >
      <Row>
        <Button
          onClick={() => void run('externalApps.set', { apps: sampleApps }, () => c().externalAppsSet(sampleApps))}
        >
          externalApps.set (this demo)
        </Button>
        <Button
          tooltip="Empty list clears the host-set entries (user-configured Settings apps are untouched)"
          onClick={() => void run('externalApps.set', { apps: [] }, () => c().externalAppsSet([]))}
        >
          externalApps.set ([])
        </Button>
        <Button onClick={() => void run('externalApps.list', {}, () => c().externalAppsList())}>
          externalApps.list
        </Button>
      </Row>
      <Hint>
        After set, check the viewer's External ribbon and Settings → External (which reports host-set apps without
        exposing them for editing). hostManaged tells the two kinds apart in list.
      </Hint>
    </DemoSection>
  );
}
