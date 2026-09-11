import { NumberInput } from '@treDeSpaceUI/widgets';
import { isMobileDevice } from '../../../../lib/render/device';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Check } from '../Check';
import { Row } from '../Row';
import { SettingsSection } from '../SettingsSection';

/** Rendering → Antialiasing: TAA accumulation, MSAA and pixel-ratio control. */
export function AntialiasingSection() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <SettingsSection
      id="antialiasing"
      title="Antialiasing"
      info={
        <>
          How the picture converges at rest and how sharp it renders. Fast AA accumulates frames into a temporal result
          (TAA) while the camera stands still; MSAA smooths edges per sample; the pixel-ratio options set the render
          resolution — Smart picks 1 on mobile and the native ratio on desktops so 1 px edge lines stay crisp.
        </>
      }
    >
      <Check
        label="AA fast (accumulation TAA)"
        checked={v.fastAA}
        shortcut="render.aaFast"
        onChange={(x) => act.update({ fastAA: x })}
      />
      <Row label="AA samples">
        <NumberInput
          value={v.aaSamples}
          min={4}
          max={128}
          step={4}
          decShortcut="render.aaSamples.dec"
          incShortcut="render.aaSamples.inc"
          onChange={(x) => act.update({ aaSamples: x })}
        />
      </Row>
      <Check label="MSAA 4x" checked={v.msaa4x} shortcut="render.msaa" onChange={(x) => act.update({ msaa4x: x })} />
      <Check
        label={`Smart pixel ratio (this device: ${isMobileDevice() ? '1' : `native ${window.devicePixelRatio}`})`}
        checked={v.smartPixelRatio}
        shortcut="render.smartPixelRatio"
        onChange={(x) => act.update({ smartPixelRatio: x })}
        info={
          <>
            Mobile devices render at ratio 1 (their integer device pixel ratio upscales evenly); desktops render at the
            native device pixel ratio — fractional Windows display scaling (125/150%) makes the 1px edge lines ragged at
            any other setting. Uncheck to control the ratio manually below.
          </>
        }
      />
      <Row label="Pixel ratio">
        <NumberInput
          value={v.pixelRatio}
          min={0.25}
          max={4}
          step={0.1}
          disabled={v.smartPixelRatio || v.useDevicePixelRatio}
          decShortcut="render.pixelRatio.dec"
          incShortcut="render.pixelRatio.inc"
          onChange={(x) => act.update({ pixelRatio: x })}
        />
      </Row>
      <Check
        label={`Use device pixel ratio (${window.devicePixelRatio})`}
        checked={v.useDevicePixelRatio}
        disabled={v.smartPixelRatio}
        shortcut="render.useDevicePixelRatio"
        onChange={(x) => act.update({ useDevicePixelRatio: x })}
      />
    </SettingsSection>
  );
}
