import { Collapsible, ColorSelect, RadioGroup } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Check } from '../Check';
import { Row } from '../Row';
import { EdgeTuning } from './EdgeTuning';

const colorModes = [
  { value: 'off', label: 'Off', shortcut: 'render.sketchColor.off' },
  { value: 'fill', label: 'Fill', hint: 'wash mesh colours onto the paper', shortcut: 'render.sketchColor.fill' },
  { value: 'edges', label: 'Edges', hint: 'ink takes the mesh colour', shortcut: 'render.sketchColor.edges' },
];

/** Edges → Sketch: the white-background edge-only mode and its own palette. */
export function SketchEdgesSection() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <Collapsible
      title="Sketch edges"
      info={
        <>
          Edge tuning used while <b>Sketch</b> mode is on (Home ribbon) — white background with edge lines only. These
          replace the normal edge settings above for the sketch look.
        </>
      }
    >
      <Check
        label="Sketch mode"
        checked={v.sketch}
        shortcut="view.sketch"
        onChange={(x) => act.update({ sketch: x })}
      />
      <Check
        label="Respect edge-off switches"
        checked={v.sketchRespectsEdgesOff}
        shortcut="render.sketchRespectsEdgesOff"
        onChange={(x) => act.update({ sketchRespectsEdgesOff: x })}
      />
      <div className="text-slate-400 text-xs">Colour from mesh (colourless stays paper)</div>
      <RadioGroup
        options={colorModes}
        value={v.sketchColorMode}
        onChange={(x) => act.update({ sketchColorMode: x as 'off' | 'fill' | 'edges' })}
      />
      <Row label="Edge colour">
        <ColorSelect value={v.sketchEdgeColor} onChange={(x) => act.update({ sketchEdgeColor: x })} />
      </Row>
      <Row label="Cube faces">
        <ColorSelect value={v.sketchCubeFaceColor} onChange={(x) => act.update({ sketchCubeFaceColor: x })} />
      </Row>
      <Row label="Cube lines">
        <ColorSelect value={v.sketchCubeLineColor} onChange={(x) => act.update({ sketchCubeLineColor: x })} />
      </Row>
      <Row label="Cube text">
        <ColorSelect value={v.sketchCubeTextColor} onChange={(x) => act.update({ sketchCubeTextColor: x })} />
      </Row>
      <Row label="Cube hover">
        <ColorSelect value={v.sketchCubeHoverColor} onChange={(x) => act.update({ sketchCubeHoverColor: x })} />
      </Row>
      <EdgeTuning
        fade={{
          value: v.sketchFadeExp,
          onChange: (x) => act.update({ sketchFadeExp: x }),
          decShortcut: 'render.sketchFade.dec',
          incShortcut: 'render.sketchFade.inc',
        }}
        depth={{
          value: v.sketchDepthThr,
          onChange: (x) => act.update({ sketchDepthThr: x }),
          decShortcut: 'render.sketchDepth.dec',
          incShortcut: 'render.sketchDepth.inc',
        }}
        normal={{
          value: v.sketchNormalThr,
          onChange: (x) => act.update({ sketchNormalThr: x }),
          decShortcut: 'render.sketchNormal.dec',
          incShortcut: 'render.sketchNormal.inc',
        }}
      />
    </Collapsible>
  );
}
