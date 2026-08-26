import { Button, Checkbox, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import type { CameraState } from '../../api/tredespace-client';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

export function NavigationSection() {
  const { run, c, line } = useDemo();
  const [name, setName] = useState('');
  const [select, setSelect] = useState(false);
  const [saved, setSaved] = useState<CameraState | null>(null);

  const handleFly = () => {
    const fullname = name.trim();
    void run('nav.flyTo', { fullname, select }, () => c().navFlyTo(fullname, { select }));
  };

  const handleOrbit = () => {
    const fullname = name.trim();
    void run('nav.orbit', { fullname, select }, () => c().navOrbit(fullname, { select }));
  };

  // camera.get → camera.set is a round trip: park a view, move around, restore
  const handleCameraGet = () => {
    void run('camera.get', {}, async () => {
      const res = await c().cameraGet();
      if (res.data) {
        setSaved(res.data);
      }

      return res;
    });
  };

  const handleCameraRestore = () => {
    if (!saved) {
      line('err', 'camera.get first — nothing saved yet');
      return;
    }

    const camera = { position: saved.position, target: saved.target, orthographic: saved.orthographic };
    void run('camera.set', camera, () => c().cameraSet(camera));
  };

  return (
    <DemoSection title="Navigation">
      <TextInput value={name} onChange={setName} placeholder="fullname (e.g. /SITE/ZONE-1/PIPE-401)" />
      <Checkbox checked={select} onChange={setSelect} label="also select it" />
      <Row>
        <Button onClick={handleFly}>nav.flyTo</Button>
        <Button onClick={handleOrbit}>nav.orbit</Button>
      </Row>
      <Hint>
        Camera: get the current pose, move the view around by hand, then restore it. The same object works as the{' '}
        <code>camera</code> option on assets.load / assets.setLoaded, which places the view instead of framing it.
      </Hint>
      <Row>
        <Button onClick={handleCameraGet}>camera.get</Button>
        <Button onClick={handleCameraRestore}>camera.set (restore)</Button>
        <Button
          tooltip="Snap 40 units out along +X, looking at the origin"
          onClick={() =>
            void run('camera.set', { position: [40, 0, 15], target: [0, 0, 0], animate: false }, () =>
              c().cameraSet({ position: [40, 0, 15], target: [0, 0, 0], animate: false }),
            )
          }
        >
          camera.set (snap)
        </Button>
      </Row>
    </DemoSection>
  );
}
