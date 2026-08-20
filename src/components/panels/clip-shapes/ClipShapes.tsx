import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { Collapsible } from '@treDeSpaceUI/widgets';
import { clipShapesState, MAX_CLIP_SHAPES } from '../../../state/viewer/clipShapes.state';
import { ClipShapesCommonSection } from './ClipShapesCommonSection';
import { ShapeRow } from './ShapeRow';

/** Clip Shapes panel — the native shapes_panel: save/load, add (fits the
 *  selection when there is one), global toggles, gizmo mode, and one editor
 *  block per shape. The Clipping Box ribbon keeps the DEFAULT box. */
export function ClipShapes() {
  useMinSize(280, 240);
  const { shapes, gizmoId } = clipShapesState.use();

  return (
    <PanelBody className="panel-body flex flex-col gap-2 p-2">
      <ClipShapesCommonSection />
      <Collapsible
        title="Clip shapes"
        aside={shapes.length}
        info={
          <>
            Extra clip volumes evaluated in the shader. Normal shapes <b>keep</b> what is inside (union); inverted
            shapes cut holes. Each row renames, enables, inverts, shows its outline, arms the gizmo, or deletes the
            shape.
          </>
        }
      >
        {shapes.length === 0 ? (
          <p className="note px-1 py-4 text-center text-slate-500">
            No clip shapes yet — add one in Common ({shapes.length}/{MAX_CLIP_SHAPES}).
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {shapes.map((s) => (
              <ShapeRow key={s.id} s={s} armed={s.id === gizmoId} />
            ))}
          </div>
        )}
      </Collapsible>
    </PanelBody>
  );
}
