import { Button, TextArea } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { isRecord } from '../util';

export function InstanceSection() {
  const { run, c, line } = useDemo();
  const [data, setData] = useState('{"project":"demo-project"}');

  /** Parse the textarea as a JSON object (the wire rejects non-objects). */
  const parseData = (): Record<string, unknown> => {
    const v: unknown = JSON.parse(data);
    if (!isRecord(v)) {
      throw new Error('instance data must be a JSON object');
    }

    return v;
  };

  const handleSet = () => {
    try {
      const parsed = parseData();
      void run('instance.set', { data: parsed }, () => c().instanceSet(parsed));
    } catch (e) {
      line('err', (e as Error).message);
    }
  };

  const handleMerge = () => {
    try {
      const parsed = parseData();
      void run('instance.set', { data: parsed, merge: true }, () => c().instanceSet(parsed, { merge: true }));
    } catch (e) {
      line('err', (e as Error).message);
    }
  };

  return (
    <DemoSection
      title="Instance data"
      info="One shared JSON object per viewer window — dialogs coordinate through it (e.g. a project selector sets
        it, others read it or react to the instance.changed event)."
    >
      <TextArea value={data} onChange={setData} rows={2} />
      <Row>
        <Button onClick={handleSet}>instance.set</Button>
        <Button onClick={handleMerge}>instance.set (merge)</Button>
        <Button onClick={() => void run('instance.get', {}, () => c().instanceGet())}>instance.get</Button>
      </Row>
    </DemoSection>
  );
}
