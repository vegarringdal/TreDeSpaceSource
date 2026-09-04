import { IconFileExport, IconSitemap } from '@tabler/icons-react';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import { ExportClipCheck } from './ExportClipCheck';
import { exportActions as act } from './export.actions';
import { exportState } from './export.state';

/** Export → GLB: hand a small visible selection to other tools, with
 *  recenter and Z-up options. */
export function ExportGlbSection() {
  const s = exportState.use();
  return (
    <Collapsible
      title="GLB"
      info={
        <>
          Made for handing a <b>small selection</b> to other tools — isolate the parts you need (hide the rest), then
          export and drop the file into PowerPoint, Blender, or any glTF viewer. It is <b>not</b> a full-scene export
          path: a whole plant makes a file most viewers choke on. Use TDP for full scenes.
          <br />
          <br />
          Exports what is currently <b>visible</b>, with the current colors, opacity and transforms, at full detail
          whatever the VRAM budget holds. Labels and measurements are not included; clipping is not baked into the
          geometry, but <b>Exclude clipped parts</b> leaves out the parts the clip volume hides entirely.
          <br />
          <br />
          Geometry is read back from the GPU on demand — nothing extra is kept in memory while you are not exporting. No
          normals are written; viewers flat-shade the result like this app does.
        </>
      }
    >
      <label
        className="flex cursor-pointer items-center gap-2 text-slate-300 text-xs"
        data-shortcut="export.recenter"
        data-tooltip="Shift the model onto its bounding-box centre — far-from-origin building coordinates lose f32 precision and break some viewers (e.g. Office)"
      >
        <input type="checkbox" checked={s.recenter} onChange={(e) => exportState.set({ recenter: e.target.checked })} />
        Recenter on bounding box
      </label>
      <label
        className="flex cursor-pointer items-center gap-2 text-slate-300 text-xs"
        data-shortcut="export.zup"
        data-tooltip="Keep the app's Z-up axes instead of converting to the glTF-standard Y-up (viewers show Z-up models tipped)"
      >
        <input type="checkbox" checked={s.zUp} onChange={(e) => exportState.set({ zUp: e.target.checked })} />
        Keep Z up
      </label>
      <ExportClipCheck />
      <Button
        icon={<IconFileExport size={14} />}
        tooltip="Export a merged GLB: one mesh primitive per color — small node count, fast to view anywhere"
        shortcut="export.merged"
        onClick={() => void act.exportGlb('merged')}
      >
        Export merged GLB (per color)
      </Button>
      <Button
        icon={<IconSitemap size={14} />}
        tooltip="Export a GLB with the full item hierarchy as named nodes — larger and slower in viewers, keeps structure"
        shortcut="export.hierarchy"
        onClick={() => void act.exportGlb('hierarchy')}
      >
        Export hierarchy GLB
      </Button>
    </Collapsible>
  );
}
