import { Button } from '@treDeSpaceUI/widgets';
import { DemoSection } from '../components/DemoSection';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

export function EventsSection() {
  const { listening, listenEvents, stopEvents } = useDemo();
  return (
    <DemoSection
      title="Events"
      info="App → host events: tree.select (tree row / model item clicked) and instance.changed (any dialog called
        instance.set). Listening is ON by default; disable calls the unsubscribe functions returned by the on*
        helpers."
    >
      <Row>
        <Button active={listening} onClick={listenEvents}>
          listen events
        </Button>
        <Button onClick={stopEvents}>stop listening</Button>
      </Row>
    </DemoSection>
  );
}
