import { Button, TextArea } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { splitLines } from '../util';

export function SelectionSection() {
  const { run, c } = useDemo();
  const [names, setNames] = useState('');

  const handleSet = () => {
    const fullnames = splitLines(names);
    void run('selection.set', { fullnames }, () => c().selectionSet(fullnames));
  };

  return (
    <DemoSection title="Selection">
      <TextArea value={names} onChange={setNames} rows={3} />
      <Hint>One fullname per line (load a model first, e.g. via Import Manager).</Hint>
      <Row>
        <Button onClick={handleSet}>selection.set</Button>
        <Button onClick={() => void run('selection.get', {}, () => c().selectionGet())}>selection.get</Button>
        <Button onClick={() => void run('selection.clear', {}, () => c().selectionClear())}>selection.clear</Button>
      </Row>
    </DemoSection>
  );
}
