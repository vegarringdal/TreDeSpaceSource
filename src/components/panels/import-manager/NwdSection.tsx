import { IconFolderPlus, IconUpload } from '@tabler/icons-react';
import { Button, Collapsible, InfoBox, useFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { FolderField, ImportOptionsRows } from './importWidgets';
import { NwdOptionsRows } from './NwdOptionsRows';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Above this size the section warns that the import may exhaust memory. */
const LARGE_NWD_BYTES = 300 * 1024 * 1024;

/** Import Manager → Navisworks NWD / NWC (converted and cooked in one wasm pass). */
export function NwdSection() {
  // -----------------------------------------------------------------------------
  // Hooks
  // -----------------------------------------------------------------------------

  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState('');
  const picker = useFilePicker('.nwd,.nwc', (f) => {
    setFile(f);
    setFolder(f.name);
  });

  // -----------------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------------

  const handleImport = async () => {
    if (!file) {
      return;
    }
    await act.importNwd(file, { folder });
    setFile(null);
  };

  // -----------------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------------

  return (
    <Collapsible
      title="Import NWD"
      defaultOpen={false}
      info={
        <>
          Navisworks <code>.nwd</code> / <code>.nwc</code> files, read by an AI-written parser — it may misread some
          parts. Each root of the model is merged and cooked straight into an asset in one pass; no intermediate file is
          written. The whole file is held in memory while it converts.
          <br />
          <br />
          <b>Normals</b> gives smooth shading (curved parts look round, the file grows). <b>Lines</b> adds the
          construction / datum lines as thin crosses. <b>Cleanup</b> welds vertices that share a position, on a grid of
          the given decimal places.
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {picker.element}
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<IconFolderPlus size={14} />}
            onClick={picker.open}
            tooltip="Pick a single .nwd / .nwc file to convert and cook (local only — nothing is uploaded)"
            shortcut="assets.nwd.pick"
          >
            Select NWD file…
          </Button>
          {file && <span className="self-center truncate text-slate-400 text-xs">{file.name}</span>}
        </div>
        {file && file.size >= LARGE_NWD_BYTES && (
          <InfoBox>
            Large file ({Math.round(file.size / 1024 / 1024)} MB): the conversion holds the inflated model in memory and
            may crash the tab — save your work first.
          </InfoBox>
        )}
        {file && (
          <>
            <ImportOptionsRows formats={['nwd']} />
            <FolderField value={folder} onChange={setFolder} labelWidth={64} />
            <NwdOptionsRows />
            <div className="flex gap-2">
              <Button
                icon={<IconUpload size={14} />}
                onClick={() => void handleImport()}
                tooltip="Convert and cook the Navisworks file into the asset library"
                shortcut="assets.nwd.import"
              >
                Import
              </Button>
              <Button onClick={() => setFile(null)} tooltip="Discard this Navisworks import">
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Collapsible>
  );
}
