import { IconFolderPlus, IconUpload } from '@tabler/icons-react';
import { Button, Collapsible, useMultiFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { FolderField, ImportOptionsRows, useImportTargetReady } from './importWidgets';
import { OptionCheckRow, OptionNumberRow, OptionSelectRow } from './optionRows';

/** Import Manager → AVEVA RVM (converted and cooked in one wasm pass). */
export function RvmSection() {
  const { rvm } = assetsState.use();
  const targetReady = useImportTargetReady();
  const [files, setFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState('');
  const picker = useMultiFilePicker('.rvm', (fs) => {
    setFiles(fs);
    setFolder(fs.length === 1 ? fs[0].name : ''); // default folder = full file name, .rvm included
  });
  const multi = files.length > 1;

  const doImport = async () => {
    if (files.length === 0) {
      return;
    }
    if (multi) {
      await act.importRvmFiles(files); // one folder per file, named after it
    } else {
      await act.importRvm(files[0], { folder });
    }
    setFiles([]);
  };

  return (
    <Collapsible
      title="Import RVM"
      defaultOpen={false}
      info={
        <>
          RVM data files come from AVEVA PDMS/E3D plant models. The <b>rvm</b> wasm converter tessellates the primitives
          and cooks each site straight into an asset (staged in browser storage) — no intermediate file.
          <br />
          <br />
          <b>Split</b> writes one file per SITE / ZONE / EQUIPMENT; <b>Tolerance</b> is the chord-height of curved
          surfaces (smaller = smoother, more triangles).
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {picker.element}
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<IconFolderPlus size={14} />}
            onClick={picker.open}
            tooltip="Pick one or more .rvm files to convert and cook (local only — nothing is uploaded)"
            shortcut="assets.rvm.pick"
          >
            Select RVM file(s)…
          </Button>
          {files.length > 0 && (
            <span className="self-center truncate text-slate-400 text-xs">
              {multi ? `${files.length} files` : files[0].name}
            </span>
          )}
        </div>
        {files.length > 0 && (
          <>
            <ImportOptionsRows />
            <div
              data-tooltip={
                multi ? 'With several files, each one imports into its own folder named after the file' : undefined
              }
            >
              <FolderField
                value={folder}
                onChange={setFolder}
                disabled={multi}
                placeholder={multi ? '(a folder is created per file)' : '(none)'}
              />
            </div>
            <OptionSelectRow
              label="Split"
              shortcut="assets.rvm.split"
              tooltip="Split the model into one file per SITE, ZONE or EQUIPMENT (hierarchy depth 0/1/2)"
              value={String(rvm.level)}
              options={[
                { value: '0', label: 'SITE' },
                { value: '1', label: 'ZONE' },
                { value: '2', label: 'EQUIPMENT' },
              ]}
              onChange={(v) => act.setRvmOptions({ level: Number(v ?? 0) })}
            />
            <OptionNumberRow
              label="Tolerance"
              tooltip="Tessellation chord-height tolerance — smaller = smoother curves, more triangles"
              value={rvm.tolerance}
              min={0.001}
              max={1}
              step={0.001}
              shortcutBase="assets.rvm.tolerance"
              onChange={(v) => act.setRvmOptions({ tolerance: v })}
            />
            <OptionCheckRow
              label="Include lines"
              shortcut="assets.rvm.includeLines"
              tooltip="Include RVM Line primitives (drawn as small crosses — numerous, adds visual noise)"
              checked={rvm.includeLines}
              onChange={(v) => act.setRvmOptions({ includeLines: v })}
            />
            {rvm.includeLines && (
              <OptionNumberRow
                label="Line width"
                tooltip="Width of the crosses drawn for Line primitives"
                value={rvm.lineWidth}
                min={0.001}
                max={1}
                step={0.001}
                shortcutBase="assets.rvm.lineWidth"
                onChange={(v) => act.setRvmOptions({ lineWidth: v })}
              />
            )}
            <OptionCheckRow
              label="Align elements"
              shortcut="assets.rvm.align"
              tooltip="Round circle tessellation to multiples of 4 segments for better flat shading"
              checked={rvm.alignElements}
              onChange={(v) => act.setRvmOptions({ alignElements: v })}
            />
            <div className="flex gap-2">
              <Button
                icon={<IconUpload size={14} />}
                disabled={!targetReady}
                onClick={() => void doImport()}
                tooltip="Convert and cook the RVM file(s) into the asset library"
                shortcut="assets.rvm.import"
              >
                Import
              </Button>
              <Button onClick={() => setFiles([])} tooltip="Discard this RVM import">
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Collapsible>
  );
}
