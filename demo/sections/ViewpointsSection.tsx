import { Button, Checkbox, TextArea, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import type { ViewpointsConfig } from '../../api/tredespace-client';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

function isViewpointsConfig(v: unknown): v is ViewpointsConfig {
  return typeof v === 'object' && v !== null && Array.isArray((v as { viewpoints?: unknown }).viewpoints);
}

/** Viewpoints as one opaque config blob (get fills the textarea, set restores
 *  it) plus the session-only host bookmark button — clicking it in the app
 *  fires the viewpoints.bookmark event with the config attached (see log). */
export function ViewpointsSection() {
  const { run, c, line } = useDemo();
  const [config, setConfig] = useState('');
  const [label, setLabel] = useState('Bookmark');
  const [url, setUrl] = useState('');
  const [showViewer, setShowViewer] = useState(true);

  const handleGet = () => {
    void run('viewpoints.get', {}, async () => {
      const res = await c().viewpointsGet();
      if (res.data) {
        setConfig(JSON.stringify(res.data.config));
      }

      return res;
    });
  };

  const handleSet = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(config);
    } catch {
      line('err', 'the textarea is not valid JSON — viewpoints.get first, or paste a saved viewpoints.json');
      return;
    }

    if (!isViewpointsConfig(parsed)) {
      line('err', 'expected { version, viewpoints: [...] } (the shape viewpoints.get returns)');
      return;
    }

    const cfg = parsed;
    void run('viewpoints.set', { config: '(textarea)', showViewer }, () => c().viewpointsSet(cfg, { showViewer }));
  };

  const handleSetUrl = () => {
    const u = url.trim();
    if (!u) {
      line('err', 'enter a viewpoints.json URL');
      return;
    }

    void run('viewpoints.setUrl', { url: u, showViewer }, () => c().viewpointsSetUrl(u, { showViewer }));
  };

  const handleShowButton = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      line('err', 'enter a button label');
      return;
    }

    void run('viewpoints.setBookmarkButton', { button: { label: trimmed } }, () =>
      c().viewpointsSetBookmarkButton({ label: trimmed, tooltip: 'Send these viewpoints to the demo host' }),
    );
  };

  return (
    <DemoSection
      title="Viewpoints"
      info="The whole viewpoint set travels as ONE opaque blob — persist it host-side per user/project and restore it
        with set. The bookmark button is session-only host UI: it appears in the Viewpoints panel, and clicking it
        fires the viewpoints.bookmark event carrying the current config (watch the log)."
    >
      <Row>
        <Button onClick={handleGet}>viewpoints.get</Button>
        <Button onClick={handleSet}>viewpoints.set</Button>
        <Checkbox
          checked={showViewer}
          onChange={setShowViewer}
          label="show viewer panel"
          tooltip="After set/setUrl, dock the Viewpoint Viewer panel on the right and make it active"
        />
      </Row>
      <TextArea value={config} onChange={setConfig} rows={3} placeholder="viewpoints.get fills this…" />
      <Row>
        <TextInput value={url} onChange={setUrl} placeholder="https://…/viewpoints.json" className="min-w-0 flex-1" />
        <Button tooltip="The viewer downloads and loads a hosted viewpoints.json" onClick={handleSetUrl}>
          viewpoints.setUrl
        </Button>
      </Row>
      <Hint>Bookmark button (open the Viewpoints panel to see it between Add viewpoint and Save):</Hint>
      <Row>
        <TextInput value={label} onChange={setLabel} placeholder="button label" className="min-w-0 flex-1" />
        <Button onClick={handleShowButton}>show button</Button>
        <Button
          onClick={() =>
            void run('viewpoints.setBookmarkButton', { button: null }, () => c().viewpointsSetBookmarkButton(null))
          }
        >
          remove
        </Button>
      </Row>
    </DemoSection>
  );
}
