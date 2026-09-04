import { Button } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { DialogControls } from './DialogControls';

/** Session-only host-managed external apps: set installs THIS demo page as a
 *  modal app in the viewer's External ribbon (openOnStart opens it right
 *  away); nothing persists — a viewer reload drops it until set again. */
export function ExternalAppsSection() {
  const { run, c } = useDemo();
  const [dialogId, setDialogId] = useState('');

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
      // width/height also size the modal (default 70% × 70%) — px, % or a number
      config: { width: '600px', height: '60%' },
    },
    {
      // home: true puts the button on the HOME ribbon instead of External —
      // for a tool the user should see right away, like a project selector.
      // homeAt picks which end of that ribbon: 'start' (default) or 'end'.
      name: 'Projects',
      url: demoDialogUrl,
      section: 'Portal',
      size: 'big' as const,
      modal: true,
      home: true,
      homeAt: 'start' as const,
      tooltip: 'A project selector promoted to the start of the Home ribbon',
      config: { width: '420px', height: '300px' },
    },
  ];

  // the modal opened by openOnStart reports its dialogId — remember it so the
  // dialog controls below have something to address
  const handleSet = () => {
    void run('externalApps.set', { apps: sampleApps }, async () => {
      const res = await c().externalAppsSet(sampleApps);
      const id = res.data?.apps.find((a) => a.dialogId)?.dialogId;
      if (id) {
        setDialogId(id);
      }

      return res;
    });
  };

  return (
    <DemoSection
      title="External apps (host-managed)"
      info="A hosting page configures the viewer's External ribbon for its context — session-only: never persisted, not
        editable in Settings, gone on reload until the host sets them again after app.ready. Set installs THIS demo
        page as a modal app and opens it immediately (openOnStart)."
    >
      <Row>
        <Button onClick={handleSet}>externalApps.set (this demo)</Button>
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
        After set, check the ribbons: "Host demo" lands under <b>External</b>, while "Projects" is flagged{' '}
        <code>home</code> so its button sits on the <b>Home</b> ribbon — one place or the other, not both (
        <code>homeAt</code> picks which end of it). Settings → External reports host-set apps without exposing them for
        editing; hostManaged tells the two kinds apart in list.
      </Hint>
      <DialogControls dialogId={dialogId} onDialogIdChange={setDialogId} />
    </DemoSection>
  );
}
