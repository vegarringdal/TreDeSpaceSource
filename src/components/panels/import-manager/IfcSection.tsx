import { IconFolderPlus, IconUpload } from '@tabler/icons-react';
import { Button, Collapsible, useFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { ExtLink, FolderField, ImportOptionsRows, useImportTargetReady } from './importWidgets';
import { OptionCheckRow, OptionSelectRow } from './optionRows';

const PART_OPTIONS = [
  { value: 'skip', label: 'Skip' },
  { value: 'include', label: 'Include' },
  { value: 'separate', label: 'Separate' },
];

/** Import Manager → IFC building models (ifc-lite → merged model → cook). */
export function IfcSection() {
  const { ifc } = assetsState.use();
  const targetReady = useImportTargetReady();
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState('');
  const picker = useFilePicker('.ifc', (f) => {
    setFile(f);
    setFolder(f.name);
  });

  const doImport = async () => {
    if (!file) {
      return;
    }
    await act.importIfc(file, { folder });
    setFile(null);
  };

  return (
    <Collapsible
      title="Import IFC"
      defaultOpen={false}
      info={
        <>
          IFC building models are parsed with <ExtLink href="https://github.com/LTplus-AG/ifc-lite">ifc-lite</ExtLink>{' '}
          converted and cooked entirely in memory — no intermediate file.
          <br />
          <br />
          <b>Split</b> writes one file per spatial tier (Site / Building / Storey). <b>Spaces</b> and <b>Openings</b>{' '}
          can be skipped, included with the geometry, or written as separate files.
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {picker.element}
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<IconFolderPlus size={14} />}
            onClick={picker.open}
            tooltip="Pick a single .ifc file to convert and cook (local only — nothing is uploaded)"
            shortcut="assets.ifc.pick"
          >
            Select IFC file…
          </Button>
          {file && <span className="self-center truncate text-slate-400 text-xs">{file.name}</span>}
        </div>
        {file && (
          <>
            <ImportOptionsRows />
            <FolderField value={folder} onChange={setFolder} labelWidth="w-16" />
            <OptionSelectRow
              label="Split"
              labelWidth="w-16"
              shortcut="assets.ifc.split"
              tooltip="Split into one file per spatial tier (Site / Building / Storey)"
              value={ifc.split}
              options={[
                { value: 'none', label: 'None (one file)' },
                { value: 'site', label: 'Site' },
                { value: 'building', label: 'Building' },
                { value: 'storey', label: 'Storey' },
              ]}
              onChange={(v) => act.setIfcOptions({ split: v ?? 'none' })}
            />
            <OptionSelectRow
              label="Quality"
              labelWidth="w-16"
              shortcut="assets.ifc.quality"
              tooltip="Tessellation quality — higher = smoother curves, more triangles"
              value={ifc.quality}
              options={[
                { value: 'lowest', label: 'Lowest' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'highest', label: 'Highest' },
              ]}
              onChange={(v) => act.setIfcOptions({ quality: v ?? 'medium' })}
            />
            <OptionSelectRow
              label="Spaces"
              labelWidth="w-16"
              tooltip="IfcSpace handling — skip, include with geometry, or as separate files"
              value={ifc.spaces}
              options={PART_OPTIONS}
              onChange={(v) => act.setIfcOptions({ spaces: v ?? 'skip' })}
            />
            <OptionSelectRow
              label="Openings"
              labelWidth="w-16"
              tooltip="Opening (void) handling — skip, include, or as separate files"
              value={ifc.openings}
              options={PART_OPTIONS}
              onChange={(v) => act.setIfcOptions({ openings: v ?? 'skip' })}
            />
            <OptionCheckRow
              label="Recenter"
              shortcut="assets.ifc.recenter"
              tooltip="Recenter the model on its bounding box"
              checked={ifc.recenter}
              onChange={(v) => act.setIfcOptions({ recenter: v })}
            />
            <div className="flex gap-2">
              <Button
                icon={<IconUpload size={14} />}
                disabled={!targetReady}
                onClick={() => void doImport()}
                tooltip="Convert and cook the IFC into the asset library"
                shortcut="assets.ifc.import"
              >
                Import
              </Button>
              <Button onClick={() => setFile(null)} tooltip="Discard this IFC import">
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Collapsible>
  );
}
