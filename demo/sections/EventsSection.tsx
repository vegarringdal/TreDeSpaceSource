import { Button } from '@treDeSpaceUI/widgets';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { IS_DIALOG, IS_POPUP } from '../hostEnv';

export function EventsSection() {
  const { listening, listenEvents, stopEvents, reloadViewer } = useDemo();
  return (
    <DemoSection
      title="Events"
      info="App → host events: tree.select (tree row / model item clicked) and instance.changed (any dialog called
        instance.set). Listening is ON by default; disable calls the unsubscribe functions returned by the on*
        helpers. The viewer also says goodbye: app.bye on reload / navigation / close (onAppBye — opt-in), then
        app.ready again once it is back (onAppReady) — the badge in the header follows both."
    >
      <Row>
        <Button active={listening} onClick={listenEvents}>
          listen events
        </Button>
        <Button onClick={stopEvents}>stop listening</Button>
        {!IS_DIALOG && !IS_POPUP && (
          <Button
            tooltip="Reload the embedded viewer: app.bye arrives first (badge turns red, in-flight requests fail), app.ready once the new boot completes"
            onClick={reloadViewer}
          >
            reload viewer (app.bye → app.ready)
          </Button>
        )}
      </Row>
      <Hint>
        After a reload the viewer has forgotten everything session-only: host apps, instance data, bus subscriptions
        (client ids are per viewer lifetime) — onAppReady is where a host puts them back.
      </Hint>
    </DemoSection>
  );
}
