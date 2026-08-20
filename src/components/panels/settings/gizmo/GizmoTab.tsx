import { Collapsible, ColorSelect, TextInput } from '@treDeSpaceUI/widgets';
import {
  DEFAULT_GIZMO_LABELS,
  type GizmoFaceName,
  gizmoLabelsActions,
  gizmoLabelsState,
} from '../../../../state/viewer/gizmoLabels.state';
import { viewerActions } from '../../../../state/viewer/viewer.actions';
import { useViewer } from '../../../../state/viewer/viewer.state';
import { Row } from '../Row';

/** Settings → Gizmo tab: view-cube face names + cube colours. */
export function GizmoTab() {
  const v = useViewer();
  const act = viewerActions;
  const gizmoLabels = gizmoLabelsState.use().labels;

  return (
    <>
      <Collapsible
        title="Gizmo"
        info="View-cube face names — the colored face buttons on the ribbons use their first letters."
      >
        {(Object.keys(DEFAULT_GIZMO_LABELS) as GizmoFaceName[]).map((face) => (
          <Row key={face} label={face[0].toUpperCase() + face.slice(1)}>
            <TextInput value={gizmoLabels[face]} onChange={(x) => gizmoLabelsActions.set(face, x)} />
          </Row>
        ))}
        <button type="button" className="btn self-start" onClick={gizmoLabelsActions.reset}>
          Reset names
        </button>
      </Collapsible>
      <Collapsible
        title="Cube colours"
        info={
          <>
            The view cube's face, line, and label-text colours. <b>Sketch</b> mode uses its own set — see Edges → Sketch
            edges.
          </>
        }
      >
        <Row label="Faces">
          <ColorSelect value={v.cubeFaceColor} onChange={(x) => act.update({ cubeFaceColor: x })} />
        </Row>
        <Row label="Lines">
          <ColorSelect value={v.cubeLineColor} onChange={(x) => act.update({ cubeLineColor: x })} />
        </Row>
        <Row label="Text">
          <ColorSelect value={v.cubeTextColor} onChange={(x) => act.update({ cubeTextColor: x })} />
        </Row>
        <Row label="Hover">
          <ColorSelect value={v.cubeHoverColor} onChange={(x) => act.update({ cubeHoverColor: x })} />
        </Row>
      </Collapsible>
    </>
  );
}
