import { Button, Checkbox, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

export function NavigationSection() {
  const { run, c } = useDemo();
  const [name, setName] = useState('');
  const [select, setSelect] = useState(false);

  const handleFly = () => {
    const fullname = name.trim();
    void run('nav.flyTo', { fullname, select }, () => c().navFlyTo(fullname, { select }));
  };

  const handleOrbit = () => {
    const fullname = name.trim();
    void run('nav.orbit', { fullname, select }, () => c().navOrbit(fullname, { select }));
  };

  return (
    <DemoSection title="Navigation">
      <TextInput value={name} onChange={setName} placeholder="fullname (e.g. /SITE/ZONE-1/PIPE-401)" />
      <Checkbox checked={select} onChange={setSelect} label="also select it" />
      <Row>
        <Button onClick={handleFly}>nav.flyTo</Button>
        <Button onClick={handleOrbit}>nav.orbit</Button>
      </Row>
    </DemoSection>
  );
}
