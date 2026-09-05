import { Collapsible, NumberInput } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Check } from '../Check';
import { Row } from '../Row';
import { TransparencySection } from './TransparencySection';

/** Rendering → Transparency, Culling and Picking. */
export function CullingSection() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <>
      <TransparencySection />

      <Collapsible title="Culling">
        <Row label="FPS limit">
          <NumberInput
            value={v.fpsLimit}
            min={5}
            max={240}
            step={5}
            unit="fps"
            decShortcut="render.fpsLimit.dec"
            incShortcut="render.fpsLimit.inc"
            onChange={(x) => act.update({ fpsLimit: x })}
          />
        </Row>
        <Check
          label="Freeze culling"
          checked={v.freezeCull}
          shortcut="render.freezeCull"
          onChange={(x) => act.update({ freezeCull: x })}
        />
        <Check
          label="Vertex-pull culling (no MDI needed)"
          checked={v.vertexPull}
          shortcut="render.vertexPull"
          onChange={(x) => act.update({ vertexPull: x })}
        />
        <Check
          label="Pixel cut while moving"
          checked={v.pxCutEnabled}
          shortcut="render.pxCut"
          onChange={(x) => act.update({ pxCutEnabled: x })}
        />
        <Row label="Cut size">
          <NumberInput
            value={v.pxCut}
            min={1}
            max={32}
            step={1}
            unit="px"
            decShortcut="render.cutSize.dec"
            incShortcut="render.cutSize.inc"
            onChange={(x) => act.update({ pxCut: x })}
          />
        </Row>
        <Row label="Protect distance">
          <NumberInput
            value={v.protectDist}
            min={0}
            step={5}
            unit="m"
            decShortcut="render.protectDist.dec"
            incShortcut="render.protectDist.inc"
            onChange={(x) => act.update({ protectDist: x })}
          />
        </Row>
      </Collapsible>

      <Collapsible
        title="Picking"
        info={
          <>
            Items at/above this opacity are clickable and block clicks; below it, clicks pass through. Shift-click flips
            the band: faint items become selectable, visible glass passes through, opaque still blocks.
          </>
        }
      >
        <Row label="Pick opacity ≥">
          <NumberInput
            value={v.pickOpacityPct}
            min={0}
            max={100}
            step={0.5}
            precision={1}
            unit="%"
            decShortcut="render.pickOpacity.dec"
            incShortcut="render.pickOpacity.inc"
            onChange={(x) => act.update({ pickOpacityPct: x })}
          />
        </Row>
      </Collapsible>
    </>
  );
}
