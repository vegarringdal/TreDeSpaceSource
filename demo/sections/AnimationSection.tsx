import { Button, Checkbox, readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { AnimationBookmarkPanel } from './AnimationBookmarkPanel';
import { AnimationScenesPanel } from './AnimationScenesPanel';

type Doc = Record<string, unknown>;

function isDoc(v: unknown): v is Doc {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Animation: pick a *.tdanim.json, load it or present it in one call (the
 *  Present workspace — the 3D view with the floating play bar), leave the
 *  mode; plus the session-only Bookmark button in the Animation ribbon. */
export function AnimationSection() {
  const { run, c, line } = useDemo();
  const [doc, setDoc] = useState<{ name: string; doc: Doc } | null>(null);
  const [play, setPlay] = useState(true);
  const [ribbon, setRibbon] = useState(true);

  const handleFile = (f: File) =>
    readFileText(f, (text) => {
      try {
        const parsed: unknown = JSON.parse(text);
        if (!isDoc(parsed)) {
          throw new Error('not an object');
        }
        setDoc({ name: f.name, doc: parsed });
        line('ok', `picked ${f.name}`);
      } catch (e) {
        line('err', `${f.name} is not an animation file (${String(e)})`);
      }
    });
  const picker = useFilePicker('.json', handleFile);

  const handleLoad = () => {
    if (!doc) {
      line('err', 'pick an animation file first');
      return;
    }
    const d = doc.doc;
    void run('animation.load', { doc: doc.name }, () => c().animationLoad(d));
  };

  /** With a picked file: load it and present it; without: present the open one. */
  const presentDoc = (d: Doc | null, label: string) => {
    void run('animation.present', { doc: label, play, ribbon }, () =>
      c().animationPresent(d ? { doc: d, play, ribbon } : { play, ribbon }),
    );
  };

  return (
    <DemoSection
      title="Animation"
      info="Load an animation file and present it in ONE call: animation.present loads the doc (optional), enters
        playback and switches to the Present workspace — the 3D view alone with the floating play bar. The Bookmark
        button is session-only host UI in the Animation ribbon; clicking it fires animation.bookmark with the
        animation attached (watch the log) — present that bookmark again below. animation.listScenes /
        animation.setScene get and pick the active scene (the highlighted one follows animation.stateChanged)."
    >
      <Row>
        <Button tooltip="Pick a *.tdanim.json (Animation ribbon → Save writes one)" onClick={picker.open}>
          Pick animation file…
        </Button>
        <Hint>{doc ? doc.name : 'no file picked'}</Hint>
        {picker.element}
      </Row>
      <Row>
        <Button tooltip="animation.load — load the picked file (animation mode is left)" onClick={handleLoad}>
          animation.load
        </Button>
        <Button
          tooltip="animation.present — load the picked file (if any) and present it"
          onClick={() => presentDoc(doc?.doc ?? null, doc?.name ?? '(the open animation)')}
        >
          animation.present
        </Button>
        <Button
          tooltip="animation.setMode off — leave animation mode (the scene is restored)"
          onClick={() => void run('animation.setMode', { mode: 'off' }, () => c().animationSetMode('off'))}
        >
          stop presenting
        </Button>
      </Row>
      <Row>
        <Checkbox checked={play} onChange={setPlay} label="play at once" tooltip="present with play: true" />
        <Checkbox
          checked={ribbon}
          onChange={setRibbon}
          label="ribbon"
          tooltip="present with ribbon: false collapses the ribbon above the 3D view"
        />
      </Row>
      <AnimationScenesPanel />
      <AnimationBookmarkPanel onPresent={presentDoc} />
    </DemoSection>
  );
}
