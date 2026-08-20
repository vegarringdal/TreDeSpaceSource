import { formatSequence, HotkeyEngine, parseSequence, recordSequence } from '@treDeSpaceUI/hotkeys';
import { Button, TextInput } from '@treDeSpaceUI/widgets';
import { useEffect, useMemo, useState } from 'react';
import { Section } from './Section';

const DEMO_BINDINGS = [
  { id: 'demo.double', keys: 'G + G', label: 'Double-tap G' },
  { id: 'demo.chord', keys: 'E&R', label: 'Chord E&R (together)' },
  { id: 'demo.leader', keys: 'ALT&SHIFT + 2', label: 'Leader ALT&SHIFT, then 2' },
];

/** Gallery section for the hotkeys module (engine + display grammar). */
export function HotkeysDemo() {
  const [fired, setFired] = useState('');
  const [progress, setProgress] = useState('');
  const [grammar, setGrammar] = useState('ALT&F1 + 101');
  const [recorded, setRecorded] = useState('');
  const [isRecording, setIsRecording] = useState(false);

  const parsed = useMemo(() => {
    try {
      return formatSequence(parseSequence(grammar));
    } catch (e) {
      return `✗ ${e instanceof Error ? e.message : 'invalid'}`;
    }
  }, [grammar]);

  const handleRecord = async (): Promise<void> => {
    setIsRecording(true);
    try {
      const seq = await recordSequence();
      setRecorded(formatSequence(seq));
    } catch {
      setRecorded('cancelled');
    } finally {
      setIsRecording(false);
    }
  };

  // A page-local engine, NOT hotkeysActions.register — the registry is an
  // app-level singleton that persists user overrides to localStorage.
  useEffect(() => {
    const engine = new HotkeyEngine();
    engine.setBindings(
      DEMO_BINDINGS.map((b) => ({ id: b.id, sequence: parseSequence(b.keys), run: () => setFired(b.label) })),
    );
    engine.setProgressListener((p) => setProgress(formatSequence(p)));
    engine.start();
    return () => engine.stop();
  }, []);

  return (
    <Section
      title="Hotkeys"
      note="The keyboard-shortcut system: a dependency-free engine with a display grammar — A&B together, A + B then, [X] hold, digit runs (101), double-taps, modifier-only leaders — plus an app-level registry (hotkeysActions.register) with per-user overrides, localStorage persistence and keymap import/export. The Tooltip widget reads that registry for its shortcut footers. This demo drives a page-local HotkeyEngine; while this tab is open, try the bindings below (they pause while typing in a field)."
      props={['HotkeyDef', 'Registered', 'Sequence']}
      code={`import { formatSequence, hotkeysActions } from '@tredespace/ui/hotkeys';

hotkeysActions.register([
  {
    id: 'view.fit', category: 'View', label: 'Fit view',
    description: 'Frame the whole model', defaultKeys: 'Z + Z',
    run: () => fitView(),
  },
]);

// render the effective (override or default) combo, e.g. in a tooltip:
const combo = formatSequence(hotkeysActions.sequenceFor('view.fit') ?? []);`}
    >
      <div className="flex flex-col gap-3">
        <div>
          {DEMO_BINDINGS.map((b) => (
            <div key={b.id} className="py-0.5">
              <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px]">
                {formatSequence(parseSequence(b.keys))}
              </code>
              <span className="ml-2 text-slate-400">{b.label}</span>
            </div>
          ))}
          <p className="m-0 mt-1.5 text-slate-500 text-xs">
            In flight: <span className="text-slate-300">{progress || '—'}</span> · Last fired:{' '}
            <span className="text-slate-300">{fired || '—'}</span>
          </p>
        </div>
        <div className="max-w-[320px]">
          <TextInput label="Grammar playground" value={grammar} onChange={setGrammar} spellCheck={false} />
          <p className="m-0 mt-1 text-slate-500 text-xs">
            parseSequence → formatSequence: <span className="text-slate-300">{parsed}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleRecord} disabled={isRecording}>
            {isRecording ? 'Recording… (Enter commits, Esc cancels)' : 'Record a sequence'}
          </Button>
          {recorded && <span className="text-slate-300 text-xs">{recorded}</span>}
        </div>
      </div>
    </Section>
  );
}
