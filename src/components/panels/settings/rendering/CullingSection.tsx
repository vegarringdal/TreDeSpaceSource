import { Checkbox, NumberInput } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { SettingsSection } from '../SettingsSection';
import { TransparencySection } from './TransparencySection';

/** The "New per frame" field reads in thousands; the setting itself counts meshlets. */
const MESHLETS_PER_K = 1000;

/** Rendering → Transparency, Culling and Picking. */
export function CullingSection() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <>
      <TransparencySection />

      <SettingsSection
        id="culling"
        title="Culling"
        info={
          <>
            GPU-side culling and frame pacing. The FPS limit caps the render loop; Cut size drops meshlets smaller than
            that many pixels while the camera moves, and Protect distance keeps the nearby ones; Freeze cull stops
            updating the visible set (debugging); Vertex pull is the culling path that needs no multi-draw extension.
          </>
        }
      >
        <NumberInput
          label="FPS limit"
          labelPosition="split"
          value={v.fpsLimit}
          min={5}
          max={240}
          step={5}
          unit="fps"
          decShortcut="render.fpsLimit.dec"
          incShortcut="render.fpsLimit.inc"
          onChange={(x) => act.update({ fpsLimit: x })}
        />
        <Checkbox
          label="Freeze culling"
          checked={v.freezeCull}
          shortcut="render.freezeCull"
          onChange={(x) => act.update({ freezeCull: x })}
        />
        <Checkbox
          label="Vertex-pull culling (no MDI needed)"
          checked={v.vertexPull}
          shortcut="render.vertexPull"
          onChange={(x) => act.update({ vertexPull: x })}
        />
        <Checkbox
          label="Pixel cut while moving"
          checked={v.pxCutEnabled}
          shortcut="render.pxCut"
          onChange={(x) => act.update({ pxCutEnabled: x })}
        />
        <NumberInput
          label="Cut size"
          labelPosition="split"
          value={v.pxCut}
          min={1}
          max={32}
          step={1}
          unit="px"
          decShortcut="render.cutSize.dec"
          incShortcut="render.cutSize.inc"
          onChange={(x) => act.update({ pxCut: x })}
        />
        <NumberInput
          label="Protect distance"
          labelPosition="split"
          value={v.protectDist}
          min={0}
          step={5}
          unit="m"
          decShortcut="render.protectDist.dec"
          incShortcut="render.protectDist.inc"
          onChange={(x) => act.update({ protectDist: x })}
        />
        <NumberInput
          label="Always cut"
          labelPosition="split"
          value={v.pxCutAlways}
          min={0}
          max={8}
          step={1}
          unit="px"
          tooltip="Independent of the moving cut above: drop meshlets this small with the camera at rest too — a sub-pixel cluster cannot be seen, and skipping them caps what a mass unhide can throw at one frame. Protect distance shields near geometry from this cut as well. 0 = off"
          decShortcut="render.cutSizeAlways.dec"
          incShortcut="render.cutSizeAlways.inc"
          onChange={(x) => act.update({ pxCutAlways: x })}
        />
        <NumberInput
          label="Meshlets per frame"
          labelPosition="split"
          // the setting counts meshlets; the field reads in thousands (25k, 50k …)
          value={v.newMeshletCap / MESHLETS_PER_K}
          min={0}
          step={25}
          precision={0}
          unit="k"
          tooltip="Cap on meshlets the occlusion pass may newly draw in ONE frame, in thousands. Unhiding a lot at once makes everything visible against an empty depth pyramid — the single heaviest frame there is, enough to hang a weak GPU. The cap spreads it over a few frames, each cheaper than the last as the pyramid fills in. 0 = no cap"
          decShortcut="render.newMeshletCap.dec"
          incShortcut="render.newMeshletCap.inc"
          onChange={(x) => act.update({ newMeshletCap: Math.round(x * MESHLETS_PER_K) })}
        />
        <NumberInput
          label="Frames after stop"
          labelPosition="split"
          value={v.settleFrames}
          min={0}
          max={600}
          step={5}
          unit="frames"
          tooltip="Keep rendering this many frames once the view settles, so geometry the cap above deferred finishes arriving. Accumulation (AA) frames count toward this window rather than adding to it. 0 = off"
          decShortcut="render.settleFrames.dec"
          incShortcut="render.settleFrames.inc"
          onChange={(x) => act.update({ settleFrames: x })}
        />
      </SettingsSection>

      <SettingsSection
        id="picking"
        title="Picking"
        info={
          <>
            Items at/above this opacity are clickable and block clicks; below it, clicks pass through. Shift-click flips
            the band: faint items become selectable, visible glass passes through, opaque still blocks.
          </>
        }
      >
        <NumberInput
          label="Pick opacity ≥"
          labelPosition="split"
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
      </SettingsSection>
    </>
  );
}
