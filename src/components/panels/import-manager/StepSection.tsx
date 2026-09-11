import { IconFolderPlus, IconUpload } from '@tabler/icons-react';
import { Button, Collapsible, useFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { ExtLink, FolderField, ImportOptionsRows, useImportTargetReady } from './importWidgets';
import { OptionCheckRow, OptionNumberRow } from './optionRows';

/** Above this size the section warns that the import may exhaust memory. */
const LARGE_STEP_BYTES = 200 * 1024 * 1024;
const MAX_STEP_WORKERS = 5;

/** Import Manager → STEP B-rep (tessellated and cooked in one wasm pass). */
export function StepSection() {
  const { step } = assetsState.use();
  const targetReady = useImportTargetReady();
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState('');
  const picker = useFilePicker('.step,.stp', (f) => {
    setFile(f);
    setFolder(f.name);
  });

  const doImport = async () => {
    if (!file) {
      return;
    }
    await act.importStep(file, { folder });
    setFile(null);
  };

  return (
    <Collapsible
      title="Import STEP"
      defaultOpen={false}
      info={
        <>
          AI-written STEP parser — it may misread some parts.{' '}
          <ExtLink href="https://github.com/vegarringdal/step2glb">step2glb</ExtLink> is the source; improvements
          welcome. The B-rep is tessellated and cooked into a single asset in one pass — no intermediate file.
          <br />
          <br />
          <b>Deflection</b> / <b>Max angle</b> control curve smoothness (smaller = smoother, more triangles).{' '}
          <b>Cleanup</b> welds duplicate positions (drops normals) to match the flat-shaded renderer.
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {picker.element}
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<IconFolderPlus size={14} />}
            onClick={picker.open}
            tooltip="Pick a single .step/.stp file to convert and cook (local only — nothing is uploaded)"
            shortcut="assets.step.pick"
          >
            Select STEP file…
          </Button>
          {file && <span className="self-center truncate text-slate-400 text-xs">{file.name}</span>}
        </div>
        {file && file.size >= LARGE_STEP_BYTES && (
          <p className="text-amber-400 text-xs">
            Large file ({Math.round(file.size / 1024 / 1024)} MB): a STEP import can need several GB of RAM (every
            tessellation worker keeps its own copy of the file index) and may crash the tab — save your work first.
            Fewer workers use less memory.
          </p>
        )}
        {file && (
          <>
            <ImportOptionsRows />
            <FolderField value={folder} onChange={setFolder} labelWidth="w-16" />
            <OptionNumberRow
              label="Deflection"
              labelWidth="w-16"
              tooltip="Chordal sag tolerance (mm) — smaller = smoother curves, more triangles"
              value={step.deflectionMm}
              min={0.01}
              max={10}
              step={0.1}
              unit="mm"
              shortcutBase="assets.step.deflection"
              onChange={(v) => act.setStepOptions({ deflectionMm: v })}
            />
            <OptionNumberRow
              label="Max angle"
              labelWidth="w-16"
              tooltip="Max chord turn angle (deg) — smaller = smoother curves, more triangles"
              value={step.maxAngleDeg}
              min={1}
              max={90}
              step={1}
              unit="deg"
              shortcutBase="assets.step.angle"
              onChange={(v) => act.setStepOptions({ maxAngleDeg: v })}
            />
            <OptionNumberRow
              label="Workers"
              labelWidth="w-16"
              tooltip="Tessellation sub-workers (0 = in-process). Each keeps its own copy of the file index: more = faster, more memory"
              value={step.workers}
              min={0}
              max={MAX_STEP_WORKERS}
              step={1}
              shortcutBase="assets.step.workers"
              onChange={(v) => act.setStepOptions({ workers: v })}
            />
            <OptionCheckRow
              label="Cleanup (weld positions)"
              shortcut="assets.step.cleanup"
              tooltip="Weld duplicate positions (drops normals) — matches the flatshaded renderer"
              checked={step.cleanup}
              onChange={(v) => act.setStepOptions({ cleanup: v })}
            />
            <div className="flex gap-2">
              <Button
                icon={<IconUpload size={14} />}
                disabled={!targetReady}
                onClick={() => void doImport()}
                tooltip="Tessellate and cook the STEP into the asset library"
                shortcut="assets.step.import"
              >
                Import
              </Button>
              <Button onClick={() => setFile(null)} tooltip="Discard this STEP import">
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Collapsible>
  );
}
