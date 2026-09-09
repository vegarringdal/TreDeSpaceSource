import { Button } from '@treDeSpaceUI/widgets';
import { DemoSection } from '../components/DemoSection';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

/** Relay demo: open this same page as a new tab in popup mode and relay the
 *  client for it — the new tab drives window.opener, and every command,
 *  result and event passes through this page's client to the viewer. Works
 *  from every mode, so a relayed window can relay again. */
export function RelaySection() {
  const { c, line } = useDemo();

  const handleOpen = () => {
    line('', '→ window.open(?popup=1) + client.relay(win, { origin })');
    try {
      const cl = c();
      const url = new URL(location.href);
      url.search = '?popup=1';
      const win = window.open(url.href, '_blank');
      if (!win) {
        line('err', '← the browser blocked the new window');
        return;
      }

      cl.relay(win, { origin: location.origin });
      line('ok', '← relaying: the new tab drives THIS page, which forwards to the viewer (watch relay.changed)');
    } catch (e) {
      line('err', `← ${(e as Error).message}`);
    }
  };

  return (
    <DemoSection
      title="Relay"
      info="client.relay(win, { origin }) forwards the API for a window this page opened: the new tab uses an
        unchanged client on window.opener and gets commands, results, events and app.ready through this page.
        relay.changed reports connected / disconnected / closed per window; the tab's client raises client.closed
        when the relay ends. A relayed tab can open and relay a tab of its own."
    >
      <Row>
        <Button onClick={handleOpen}>open relayed window</Button>
      </Row>
    </DemoSection>
  );
}
