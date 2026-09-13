import { IconFolderPlus, IconUpload } from '@tabler/icons-react';
import { Button, Checkbox, Collapsible, useFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { FolderField, ImportOptionsRows, useImportTargetReady } from './importWidgets';

/** Import Manager → standard/gpu-instanced glTF (cooked with optional normals). */
export function StdGlbSection() {
  const { stdGlb } = assetsState.use();
  const targetReady = useImportTargetReady();
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState('');
  const picker = useFilePicker('.glb', (f) => {
    setFile(f);
    setFolder(f.name.replace(/\.glb$/i, ''));
  });

  const doImport = async () => {
    if (!file) {
      return;
    }
    await act.importStandardGlb(file, { folder });
    setFile(null);
  };

  return (
    <Collapsible
      title="Import standard GLB"
      defaultOpen={false}
      info={
        <>
          Any exporter's glTF: plain node trees and <b>gpu-instanced</b> (EXT_mesh_gpu_instancing) files — everything
          the rvm2glb CLI writes besides merged.
          <br />
          <br />
          <b>Not supported:</b> textures/UVs, skinning, morph targets and special extensions (Draco, meshopt/quantized
          attributes) — such files import as plain colored geometry or are skipped. Use <b>Import normals</b> to keep
          smooth shading; leave it off for flat shading with full facet edges.
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {picker.element}
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<IconFolderPlus size={14} />}
            onClick={picker.open}
            tooltip="Pick a single standard .glb file to cook into the asset library (local only — nothing is uploaded)"
            shortcut="assets.stdglb.pick"
          >
            Select GLB file…
          </Button>
          {file && <span className="self-center truncate text-slate-400 text-xs">{file.name}</span>}
        </div>
        {file && (
          <>
            <ImportOptionsRows />
            <FolderField value={folder} onChange={setFolder} labelWidth={64} />
            <Checkbox
              label="Import normals"
              checked={stdGlb.normals}
              onChange={(normals) => act.setStdGlbOptions({ normals })}
              shortcut="assets.stdglb.normals"
              tooltip="Keep authored normals (smooth shading). Off = flat shading — which also restores the full facet edge lines"
            />
            <Checkbox
              label="Edge lines"
              checked={stdGlb.edges}
              onChange={(edges) => act.setStdGlbOptions({ edges })}
              shortcut="assets.stdglb.edges"
              tooltip="Draw edge lines on this model when loaded — off for meshes where edges would fight the surface (stored per asset)"
            />
            <div className="flex gap-2">
              <Button
                icon={<IconUpload size={14} />}
                disabled={!targetReady}
                onClick={() => void doImport()}
                tooltip="Cook the standard GLB into the asset library"
                shortcut="assets.stdglb.import"
              >
                Import
              </Button>
              <Button onClick={() => setFile(null)} tooltip="Discard this GLB import">
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Collapsible>
  );
}
