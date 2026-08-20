import { Collapsible, ColorSelect, NumberInput } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Row } from '../Row';

/** Settings → Lighting tab: ambient + headlight color and intensity. */
export function LightingTab() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <Collapsible title="Lighting">
      <Row label="Ambient colour">
        <ColorSelect value={v.ambientColor} onChange={(x) => act.update({ ambientColor: x })} />
      </Row>
      <Row label="Ambient intensity">
        <NumberInput
          value={v.ambientIntensity}
          min={0}
          max={2}
          step={0.05}
          decShortcut="render.ambient.dec"
          incShortcut="render.ambient.inc"
          onChange={(x) => act.update({ ambientIntensity: x })}
        />
      </Row>
      <Row label="Headlight colour">
        <ColorSelect value={v.headlightColor} onChange={(x) => act.update({ headlightColor: x })} />
      </Row>
      <Row label="Headlight intensity">
        <NumberInput
          value={v.headlightIntensity}
          min={0}
          max={2}
          step={0.05}
          decShortcut="render.headlight.dec"
          incShortcut="render.headlight.inc"
          onChange={(x) => act.update({ headlightIntensity: x })}
        />
      </Row>
    </Collapsible>
  );
}
