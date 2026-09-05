import { Button, TextArea } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { splitLines } from '../util';

const toLabels = (names: string[]) =>
  names.map((fullname) => ({ text: fullname.split('/').filter(Boolean).pop() ?? fullname, fullname }));

export function LabelsSection() {
  const { run, c } = useDemo();
  const [names, setNames] = useState('');

  const handleSet = () => {
    const labels = toLabels(splitLines(names));
    void run('labels.set', { labels }, () => c().labelsSet(labels));
  };

  const handleAdd = () => {
    const labels = toLabels(splitLines(names));
    void run('labels.add', { labels }, () => c().labelsAdd(labels));
  };

  const handleAnchor = () => {
    // a sphere marker draws the anchor IN the scene, depth tested
    const labels = [
      { text: 'Demo anchor', anchor: [0, 0, 0] as [number, number, number], sphere: { size: 0.2, color: '#ff8800' } },
    ];
    void run('labels.add', { labels }, () => c().labelsAdd(labels));
  };

  return (
    <DemoSection title="Labels">
      <TextArea value={names} onChange={setNames} rows={3} />
      <Hint>One fullname per line; label text becomes the last path segment.</Hint>
      <Row>
        <Button onClick={handleSet}>labels.set</Button>
        <Button onClick={handleAdd}>labels.add</Button>
        <Button onClick={handleAnchor}>labels.add (anchor @ origin)</Button>
        <Button onClick={() => void run('labels.clear', {}, () => c().labelsClear())}>labels.clear</Button>
        <Button onClick={() => void run('labels.get', {}, () => c().labelsGet())}>labels.get</Button>
      </Row>
      <Row>
        <Button onClick={() => void run('labels.explode', {}, () => c().labelsExplode())}>labels.explode</Button>
        <Button onClick={() => void run('labels.implode', {}, () => c().labelsImplode())}>labels.implode</Button>
      </Row>
    </DemoSection>
  );
}
