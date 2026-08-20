import { Collapsible, ColorSelect, NumberInput } from '@treDeSpaceUI/widgets';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Check } from '../Check';
import { Row } from '../Row';
import { EdgeTuning } from './EdgeTuning';
import { SketchEdgesSection } from './SketchEdgesSection';

/** Settings → Edges tab: common switches + per-shading-type edge tuning. */
export function EdgesTab() {
  const v = useViewer();
  const act = viewerActions;

  return (
    <div className="flex flex-col gap-1.5">
      <Collapsible
        title="Edges — common"
        info="Global edge switches plus the styling shared by every mesh: line colour and the white-on-dark override. The two categories below tune the edge-detection thresholds per shading type."
      >
        <Check
          label="Geometry edges"
          checked={v.geoEdges}
          shortcut="render.geoEdges"
          onChange={(x) => act.update({ geoEdges: x })}
        />
        <Check
          label="Item edges"
          checked={v.itemEdges}
          shortcut="render.itemEdges"
          onChange={(x) => act.update({ itemEdges: x })}
        />
        <Row label="Edge colour">
          <ColorSelect value={v.edgeColor} onChange={(x) => act.update({ edgeColor: x })} />
        </Row>
        <Check
          label="White edges on dark items"
          checked={v.whiteOnDark}
          shortcut="render.whiteOnDark"
          onChange={(x) => act.update({ whiteOnDark: x })}
        />
        <Row label="Darkness threshold">
          <NumberInput
            value={v.darkThr}
            min={0}
            max={1}
            step={0.01}
            precision={3}
            decShortcut="render.edgeDark.dec"
            incShortcut="render.edgeDark.inc"
            onChange={(x) => act.update({ darkThr: x })}
          />
        </Row>
      </Collapsible>

      <Collapsible
        title="Edges — flat shading (default)"
        info="Edge detection for flat-shaded meshes — the default look (GLBs imported without normals, and everything cooked flat). Fade/thresholds here don't affect meshes with authored normals."
      >
        <Check
          label="Edge lines on flat meshes"
          checked={v.flatMeshEdges}
          shortcut="render.flatMeshEdges"
          onChange={(x) => act.update({ flatMeshEdges: x })}
        />
        <EdgeTuning
          fade={{
            value: v.fadeExp,
            onChange: (x) => act.update({ fadeExp: x }),
            decShortcut: 'render.edgeFade.dec',
            incShortcut: 'render.edgeFade.inc',
          }}
          depth={{
            value: v.depthThr,
            onChange: (x) => act.update({ depthThr: x }),
            decShortcut: 'render.edgeDepth.dec',
            incShortcut: 'render.edgeDepth.inc',
          }}
          normal={{
            value: v.normalThr,
            onChange: (x) => act.update({ normalThr: x }),
            decShortcut: 'render.edgeNormal.dec',
            incShortcut: 'render.edgeNormal.inc',
          }}
        />
      </Collapsible>

      <Collapsible
        title="Edges — with normals"
        info="Separate edge tuning for meshes that carry authored normals (smooth shading) — e.g. standard GLBs imported with 'Import normals' on."
      >
        <Check
          label="Edge lines on meshes with normals"
          checked={v.smoothMeshEdges}
          shortcut="render.smoothMeshEdges"
          onChange={(x) => act.update({ smoothMeshEdges: x })}
        />
        <EdgeTuning
          fade={{
            value: v.smoothFadeExp,
            onChange: (x) => act.update({ smoothFadeExp: x }),
            decShortcut: 'render.smoothFade.dec',
            incShortcut: 'render.smoothFade.inc',
          }}
          depth={{
            value: v.smoothDepthThr,
            onChange: (x) => act.update({ smoothDepthThr: x }),
            decShortcut: 'render.smoothDepth.dec',
            incShortcut: 'render.smoothDepth.inc',
          }}
          normal={{
            value: v.smoothNormalThr,
            onChange: (x) => act.update({ smoothNormalThr: x }),
            decShortcut: 'render.smoothNormal.dec',
            incShortcut: 'render.smoothNormal.inc',
          }}
        />
      </Collapsible>

      <SketchEdgesSection />
    </div>
  );
}
