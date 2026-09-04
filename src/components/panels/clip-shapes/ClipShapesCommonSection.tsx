import { IconPlus } from '@tabler/icons-react';
import { Button, Collapsible, readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import { useEffect } from 'react';
import { clipShapesActions as act } from '../../../state/viewer/clipShapes.actions';
import { clipShapesState, MAX_CLIP_SHAPES, supportsRotate } from '../../../state/viewer/clipShapes.state';
import { dialogs } from '../../dialogs/dialogs.actions';
import { ribbonClippingBoxState } from '../ribbon-clipping-box/ribbonClippingBox.state';
import { registerClipShapesLoad } from './clipShapesPanel';
import { ribbonClipShapesActions as ribbon } from './ribbonClipShapes.actions';

/** Clip Shapes → Common: add shapes, save/load, global toggles, gizmo mode. */
export function ClipShapesCommonSection() {
  const { shapes, muted, helpers, gizmoId, gizmoMode, sixAxis } = clipShapesState.use();
  const boxOn = ribbonClippingBoxState.use().boxOn;
  const armed = shapes.find((s) => s.id === gizmoId);
  const picker = useFilePicker('application/json,.json', (f) =>
    readFileText(f, (text) => {
      try {
        const n = act.importJson(text);
        void dialogs.confirm(`Loaded ${n} clip shape(s).`, { okLabel: 'OK' });
      } catch (e) {
        void dialogs.confirm(`Import failed: ${e instanceof Error ? e.message : String(e)}`, { okLabel: 'OK' });
      }
    }),
  );

  // let the clip.shape.load hotkey pop the file picker
  useEffect(() => {
    registerClipShapesLoad(picker.open);
    return () => registerClipShapesLoad(null);
  }, [picker.open]);

  return (
    <Collapsible
      title="Common"
      info="Add sphere/cylinder/box clip volumes — a new shape fits the current selection, or the whole scene when nothing is selected. Save/Load stores the set as JSON. Delete all, Hide all, Hide main box and Helpers are global toggles; the Gizmo row arms move/rotate/scale on whichever shape you've armed below."
    >
      <div className="grid grid-cols-3 gap-1.5">
        <Button
          className="w-full"
          icon={<IconPlus size={14} />}
          disabled={shapes.length >= MAX_CLIP_SHAPES}
          onClick={ribbon.addSphere}
          tooltip="Add a sphere clip shape (fits the selection when there is one)"
          shortcut="clip.shape.addSphere"
        >
          Sphere
        </Button>
        <Button
          className="w-full"
          icon={<IconPlus size={14} />}
          disabled={shapes.length >= MAX_CLIP_SHAPES}
          onClick={ribbon.addCylinder}
          tooltip="Add a cylinder clip shape (fits the selection when there is one)"
          shortcut="clip.shape.addCylinder"
        >
          Cylinder
        </Button>
        <Button
          className="w-full"
          icon={<IconPlus size={14} />}
          disabled={shapes.length >= MAX_CLIP_SHAPES}
          onClick={ribbon.addBox}
          tooltip="Add a box clip shape (fits the selection when there is one)"
          shortcut="clip.shape.addBox"
        >
          Box
        </Button>
        <Button
          className="w-full"
          onClick={() => act.downloadJson()}
          tooltip="Save all shapes to a JSON file"
          shortcut="clip.shape.save"
        >
          Save…
        </Button>
        <Button
          className="w-full"
          onClick={picker.open}
          tooltip="Load shapes from a JSON file"
          shortcut="clip.shape.load"
        >
          Load…
        </Button>
        <Button
          className="w-full"
          disabled={shapes.length === 0}
          onClick={() => act.clear()}
          tooltip="Delete every shape"
          shortcut="clip.shape.clear"
        >
          Delete all
        </Button>
        <Button
          className="w-full"
          active={muted}
          onClick={() => act.toggleMuted()}
          tooltip="Hide all shapes (keeps the list)"
          shortcut="clip.shape.mute"
        >
          Hide all
        </Button>
        <Button
          className="w-full"
          active={!boxOn}
          onClick={() => ribbonClippingBoxState.set((s) => ({ boxOn: !s.boxOn }))}
          tooltip="Hide the default clip box only (global clipping stays on)"
          shortcut="clip.shape.hideDefault"
        >
          Hide main box
        </Button>
        <Button
          className="w-full"
          active={helpers}
          onClick={() => act.toggleHelpers()}
          tooltip="Show / hide ALL shape outlines"
          shortcut="clip.shape.helpers"
        >
          Helpers
        </Button>
        {picker.element}
      </div>

      <div className="grid grid-cols-5 items-center gap-1.5">
        <span className="px-1 text-[11px] text-slate-400">Gizmo</span>
        {(['move', 'rotate', 'scale'] as const).map((m) => (
          <Button
            key={m}
            className="w-full"
            active={gizmoMode === m && armed != null}
            disabled={armed == null || (m === 'rotate' && !supportsRotate(armed.kind))}
            onClick={() => act.setGizmoMode(m)}
            tooltip={`Shape gizmo: ${m} (arm a shape with its Gizmo button)`}
            shortcut={`clip.shape.gizmo.${m}`}
          >
            {m[0].toUpperCase() + m.slice(1)}
          </Button>
        ))}
        <Button
          className="w-full"
          active={sixAxis}
          disabled={armed == null || gizmoMode !== 'scale' || armed.kind === 'sphere'}
          onClick={act.toggleSixAxis}
          tooltip={
            'Scale handles of the armed shape: 6 axis = per face (a box), or diameter + top + bottom (a cylinder); 3 axis = symmetric'
          }
          shortcut="clip.shape.sixAxis"
        >
          {sixAxis ? '6 Axis' : '3 Axis'}
        </Button>
      </div>
    </Collapsible>
  );
}
