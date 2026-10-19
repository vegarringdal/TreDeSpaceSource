import { Button } from '@treDeSpaceUI/widgets';
import { useEffect, useState } from 'react';
import type { AnimationSceneInfo } from '../../api/tredespace-client';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';

/** The open animation's scenes: list them, make one active, and follow the
 *  active scene as `animation.stateChanged` reports it (the user switching
 *  in the Timeline or the play bar shows here too). */
export function AnimationScenesPanel() {
  const { run, c, connection } = useDemo();
  const [scenes, setScenes] = useState<AnimationSceneInfo[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (connection !== 'connected') {
      return;
    }
    const ac = new AbortController();
    try {
      c().onAnimationState((e) => setActive(e.scene), { signal: ac.signal });
    } catch {
      // no client yet — the next connection subscribes
    }
    return () => ac.abort();
  }, [connection, c]);

  const handleList = () =>
    void run('animation.listScenes', {}, async () => {
      const r = await c().animationListScenes();
      if (r.data) {
        setScenes(r.data.scenes);
        setActive(r.data.active);
      }
      return r;
    });

  const handleSet = (id: string) =>
    void run('animation.setScene', { id }, async () => {
      const r = await c().animationSetScene(id);
      if (r.data) {
        setActive(r.data.scene);
      }
      return r;
    });

  return (
    <Row>
      <Button tooltip="animation.listScenes — the open animation's scenes and the active one" onClick={handleList}>
        animation.listScenes
      </Button>
      {scenes.map((s) => (
        <Button
          key={s.id}
          active={s.id === active}
          tooltip={`animation.setScene — make "${s.name || s.id}" the active scene (${s.duration.toFixed(1)} s, ${s.steps} steps, ${s.objects} objects)`}
          onClick={() => handleSet(s.id)}
        >
          {s.name || s.id}
        </Button>
      ))}
      {scenes.length === 0 && <Hint>list the scenes to pick one</Hint>}
    </Row>
  );
}
