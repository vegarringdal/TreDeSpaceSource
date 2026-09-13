import { ColorSelect, NumberInput } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { SettingsSection } from '../SettingsSection';

/** Settings → Lighting tab: ambient + headlight colour and intensity, once for
 *  the shaded scene and once for Sketch mode. */
export function LightingTab() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <div className="flex flex-col gap-1.5">
      <SettingsSection
        id="lighting"
        title="Lighting"
        info={
          <>
            The shaded look: a colour-tinted ambient term that lights every surface evenly, plus a headlight that
            follows the camera and gives shape to what you look at. Intensities above 1 overexpose deliberately; 0 turns
            a light off.
          </>
        }
      >
        <ColorSelect
          label="Ambient colour"
          labelPosition="split"
          value={v.ambientColor}
          onChange={(x) => act.update({ ambientColor: x })}
        />
        <NumberInput
          label="Ambient intensity"
          labelPosition="split"
          value={v.ambientIntensity}
          min={0}
          max={2}
          step={0.05}
          decShortcut="render.ambient.dec"
          incShortcut="render.ambient.inc"
          onChange={(x) => act.update({ ambientIntensity: x })}
        />
        <ColorSelect
          label="Headlight colour"
          labelPosition="split"
          value={v.headlightColor}
          onChange={(x) => act.update({ headlightColor: x })}
        />
        <NumberInput
          label="Headlight intensity"
          labelPosition="split"
          value={v.headlightIntensity}
          min={0}
          max={2}
          step={0.05}
          decShortcut="render.headlight.dec"
          incShortcut="render.headlight.inc"
          onChange={(x) => act.update({ headlightIntensity: x })}
        />
      </SettingsSection>
      <SettingsSection
        id="sketchLighting"
        title="Sketch lighting"
        info={
          <>
            The same two lights, used only while <b>Sketch</b> mode is on (Home ribbon). The paper-white look usually
            wants a flatter, brighter light than the shaded scene, so this set is kept apart — like the sketch edge
            tuning and cube colours.
          </>
        }
      >
        <ColorSelect
          label="Ambient colour"
          labelPosition="split"
          value={v.sketchAmbientColor}
          onChange={(x) => act.update({ sketchAmbientColor: x })}
        />
        <NumberInput
          label="Ambient intensity"
          labelPosition="split"
          value={v.sketchAmbientIntensity}
          min={0}
          max={2}
          step={0.05}
          decShortcut="render.sketchAmbient.dec"
          incShortcut="render.sketchAmbient.inc"
          onChange={(x) => act.update({ sketchAmbientIntensity: x })}
        />
        <ColorSelect
          label="Headlight colour"
          labelPosition="split"
          value={v.sketchHeadlightColor}
          onChange={(x) => act.update({ sketchHeadlightColor: x })}
        />
        <NumberInput
          label="Headlight intensity"
          labelPosition="split"
          value={v.sketchHeadlightIntensity}
          min={0}
          max={2}
          step={0.05}
          decShortcut="render.sketchHeadlight.dec"
          incShortcut="render.sketchHeadlight.inc"
          onChange={(x) => act.update({ sketchHeadlightIntensity: x })}
        />
      </SettingsSection>
    </div>
  );
}
