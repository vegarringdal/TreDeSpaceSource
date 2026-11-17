import { Button, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { useRef, useState } from 'react';
import type { ClientInfo } from '../../api/tredespace-client';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { IS_DIALOG, IS_POPUP } from '../hostEnv';
import { ClientList } from './ClientList';

const DEFAULT_NAME = IS_DIALOG ? 'dialog demo' : IS_POPUP ? 'popup demo' : 'host demo';

/** The custom-event bus: subscribe (name / tag / event filter), list the
 *  connected clients, post to everyone or to the ticked clients. Needs a
 *  second page on the same viewer to be interesting — see the info text. */
export function CustomEventsSection() {
  const { run, c, line } = useDemo();
  const [name, setName] = useState(DEFAULT_NAME);
  const [tag, setTag] = useState('demo');
  const [filter, setFilter] = useState('');
  const [event, setEvent] = useState('demo.ping');
  const [data, setData] = useState('{"hello":"world"}');
  const [clients, setClients] = useState<readonly ClientInfo[]>([]);
  const [self, setSelf] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const ctrlRef = useRef<AbortController | null>(null);
  const presenceOffRef = useRef<(() => void) | null>(null);

  const subscribeOptions = () => ({
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(tag.trim() ? { tag: tag.trim() } : {}),
    ...(filter.trim()
      ? {
          events: filter
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
  });

  /** The textarea as any JSON value (the bus carries JSON, not only objects). */
  const parseData = (): unknown => JSON.parse(data);

  const applyClients = (list: readonly ClientInfo[]) => {
    setClients(list);
    setSelected((sel) => sel.filter((id) => list.some((cl) => cl.id === id)));
  };

  // one live subscription: a repeat subscribe aborts the previous handler
  // (which leaves the bus when it was the last one) before joining again
  const handleSubscribe = () => {
    const opts = subscribeOptions();
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    presenceOffRef.current ??= c().onClientsChanged((e) => {
      line('out', `⚡ custom.clients.changed — ${e.clients.length} client(s)`);
      applyClients(e.clients);
    });
    void run('custom.subscribe', opts, async () => {
      const res = await c().customSubscribe(
        (e) =>
          line(
            'out',
            `⚡ custom.event "${e.event}" from ${e.from.id} (${e.from.name ?? e.from.kind}) ${JSON.stringify(e.data)}`,
          ),
        { ...opts, signal: ctrl.signal },
      );
      if (res.data) {
        setSelf(res.data.clientId);
      }

      return res;
    });
  };

  const handleUnsubscribe = () => {
    ctrlRef.current = null;
    void run('custom.unsubscribe', {}, () => c().customUnsubscribe());
  };

  const handleClients = () =>
    void run('custom.clients', {}, async () => {
      const res = await c().customClients();
      if (res.data) {
        setSelf(res.data.self);
        applyClients(res.data.clients);
      }

      return res;
    });

  const handlePost = (to?: readonly string[]) => {
    try {
      const parsed = parseData();
      const req = { event, data: parsed, ...(to ? { to } : {}) };
      void run('custom.post', req, () => c().customPost(event, parsed, to ? { to: [...to] } : undefined));
    } catch (e) {
      line('err', (e as Error).message);
    }
  };

  const handleToggle = (id: string, on: boolean) =>
    setSelected((sel) => (on ? [...sel, id] : sel.filter((x) => x !== id)));

  return (
    <DemoSection
      title="Custom events"
      info="A message bus between the pages connected to one viewer: subscribe with a name, a tag and an optional
        event filter (comma-separated names; empty = every event), list who is connected, then post to everyone
        or only to the ticked clients. A sender never receives its own event, so open a second page on the same
        viewer: External apps → externalApps.set (this demo) puts this page inside the viewer as a modal, or the
        Relay section opens one in a window — subscribe there too and watch its console. JSON only; keep secrets
        off the bus."
    >
      <TextInput label="name" labelPosition="left" labelWidth={44} value={name} onChange={setName} />
      <TextInput label="tag" labelPosition="left" labelWidth={44} value={tag} onChange={setTag} />
      <TextInput
        label="events"
        labelPosition="left"
        labelWidth={44}
        value={filter}
        onChange={setFilter}
        placeholder="all — or demo.ping, row.pick"
      />
      <Row>
        <Button onClick={handleSubscribe}>custom.subscribe</Button>
        <Button onClick={handleUnsubscribe}>custom.unsubscribe</Button>
        <Button onClick={handleClients}>custom.clients</Button>
      </Row>
      <ClientList clients={clients} self={self} selected={selected} onToggle={handleToggle} />
      <TextInput label="event" labelPosition="left" labelWidth={44} value={event} onChange={setEvent} />
      <TextArea value={data} onChange={setData} rows={2} />
      <Row>
        <Button onClick={() => handlePost()}>custom.post (all subscribers)</Button>
        <Button disabled={selected.length === 0} onClick={() => handlePost(selected)}>
          custom.post (ticked: {selected.length})
        </Button>
      </Row>
      <Hint>
        Post reports <code>delivered</code> and <code>missed</code> — tick a client that is not subscribed to see it
        land in missed.
      </Hint>
    </DemoSection>
  );
}
