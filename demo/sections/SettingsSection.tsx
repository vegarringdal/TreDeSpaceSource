import { Button, Select, TextArea } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import type {
  AoSettings,
  EdgesSettings,
  GizmoLabels,
  GizmoSettings,
  LightingSettings,
  RenderingSettings,
  Result,
  SettingsPatch,
  TredespaceClient,
} from '../../api/tredespace-client';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { isRecord } from '../util';

type Tab = 'rendering' | 'lighting' | 'edges' | 'ao' | 'gizmo';

const TABS: readonly { value: Tab; label: string; sample: string }[] = [
  { value: 'rendering', label: 'rendering', sample: '{"fastAA":true,"aaSamples":16,"bgColor":"#202020"}' },
  { value: 'lighting', label: 'lighting', sample: '{"ambientIntensity":0.4,"headlightColor":"#fff4e0"}' },
  { value: 'edges', label: 'edges', sample: '{"geoEdges":true,"edgeColor":"black","sketchColorMode":"fill"}' },
  { value: 'ao', label: 'ao', sample: '{"aoMode":2,"aoStrength":0.25}' },
  {
    value: 'gizmo',
    label: 'gizmo',
    sample: '{"cubeFaceColor":"#1e2a3a","labels":{"front":"N","back":"S","top":"UP"}}',
  },
];

type GizmoPatch = Partial<Omit<GizmoSettings, 'labels'>> & { labels?: Partial<GizmoLabels>; reset?: boolean };

// the textarea is free JSON; the viewer validates every key and value, so
// the narrowing here is the one cast the demo makes
const SETTERS: Record<Tab, (c: TredespaceClient, p: Record<string, unknown>) => Promise<Result<unknown>>> = {
  rendering: (c, p) => c.settingsRenderingSet(p as SettingsPatch<RenderingSettings>),
  lighting: (c, p) => c.settingsLightingSet(p as SettingsPatch<LightingSettings>),
  edges: (c, p) => c.settingsEdgesSet(p as SettingsPatch<EdgesSettings>),
  ao: (c, p) => c.settingsAoSet(p as SettingsPatch<AoSettings>),
  gizmo: (c, p) => c.settingsGizmoSet(p as GizmoPatch),
};

/** Per-tab settings setters (company defaults from a host page) and the GPU
 *  report. One JSON editor per tab: get fills it with the tab's current
 *  values (an empty call), set sends what is in it, reset returns the tab to
 *  defaults first. */
export function SettingsSection() {
  const { run, c, line } = useDemo();
  const [tab, setTab] = useState<Tab>('rendering');
  const [patch, setPatch] = useState(TABS[0].sample);

  const command = `settings.${tab}.set`;

  const handleTab = (value: string | null) => {
    const next = TABS.find((t) => t.value === value);
    if (!next) {
      return;
    }

    setTab(next.value);
    setPatch(next.sample);
  };

  const send = (p: Record<string, unknown>) => void run(command, p, () => SETTERS[tab](c(), p));

  // the empty call returns the whole tab — hand it to the editor so the user
  // edits real values and sends exactly that back
  const handleGet = () =>
    void run(command, {}, async () => {
      const res = await SETTERS[tab](c(), {});
      if (res.data !== undefined) {
        setPatch(JSON.stringify(res.data, null, 2));
      }

      return res;
    });

  const handleSet = () => {
    try {
      const v: unknown = JSON.parse(patch);
      if (!isRecord(v)) {
        throw new Error('the patch must be a JSON object');
      }

      send(v);
    } catch (e) {
      line('err', (e as Error).message);
    }
  };

  return (
    <DemoSection
      title="Settings & GPU"
      info="A host page rolls out company defaults per Settings tab: any subset of that tab's keys, strictly
        validated (an unknown key, a wrong type or a bad colour is a bad-payload error and nothing applies),
        persisted exactly like an edit in the Settings panel — so send them once after app.ready, not on every
        load. An empty call reads; reset: true returns the tab to defaults first. gpu.info.get reports the
        adapter the viewer renders on, what the high-performance / low-power / fallback hints resolve to
        (hasMultipleGpus), the features in use and the suggested VRAM budget."
    >
      <Row>
        <Button onClick={() => void run('gpu.info.get', {}, () => c().gpuInfoGet())}>gpu.info.get</Button>
        <Button onClick={() => void run('settings.get', {}, () => c().settingsGet())}>settings.get</Button>
      </Row>
      <Select value={tab} onChange={handleTab} options={TABS.map(({ value, label }) => ({ value, label }))} />
      <Row>
        <Button
          tooltip="An empty payload changes nothing and returns the tab's values — loaded into the editor below"
          onClick={handleGet}
        >
          get → editor
        </Button>
      </Row>
      <TextArea value={patch} onChange={setPatch} rows={6} />
      <Row>
        <Button onClick={handleSet}>{command}</Button>
        <Button tooltip="reset: true returns the whole tab to its defaults" onClick={() => send({ reset: true })}>
          reset to defaults
        </Button>
      </Row>
      <Hint>
        Pick a tab, press get to load its current values, edit any of them and send the editor back with set. Try a typo
        in a key (<code>aoRadiu</code>) to see the strict bad-payload error naming the allowed keys. Colours accept{' '}
        <code>#rrggbb</code> or a CSS name and come back normalised.
      </Hint>
    </DemoSection>
  );
}
