import { Button, NumberInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

export function ClipSection() {
  const { run, c } = useDemo();
  const [offset, setOffset] = useState(0);

  const handleAddSphere = () => {
    const shapes = [{ kind: 'sphere' as const, center: [0, 0, 0] as [number, number, number], radius: 5 }];
    void run('clip.shapes.add', { shapes }, () => c().clipShapesAdd(shapes));
  };

  return (
    <DemoSection title="Clip box & shapes">
      <Row>
        <span className="text-slate-400">offset</span>
        <NumberInput value={offset} onChange={setOffset} step={1} unit="m" className="w-28" />
      </Row>
      <Row>
        <Button onClick={() => void run('clip.box.fitSelected', { offset }, () => c().clipBoxFitSelected(offset))}>
          clip.box.fitSelected (needs a selection)
        </Button>
        <Button onClick={handleAddSphere}>clip.shapes.add (sphere r=5 @ origin)</Button>
      </Row>
      <Row>
        <Button onClick={() => void run('clip.box.get', {}, () => c().clipBoxGet())}>clip.box.get</Button>
        <Button onClick={() => void run('clip.box.disable', {}, () => c().clipBoxDisable())}>clip.box.disable</Button>
        <Button onClick={() => void run('clip.reset', {}, () => c().clipReset())}>
          clip.reset (disable box + remove shapes)
        </Button>
      </Row>
    </DemoSection>
  );
}
