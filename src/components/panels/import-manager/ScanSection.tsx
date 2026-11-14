import { IconFolderPlus, IconUpload } from '@tabler/icons-react';
import { Button, Collapsible, useMultiFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { SCAN_SOURCE_RE } from '../../../lib/scan2tdpp/cookScan';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { storeFormatOf } from '../../../state/assets/sourceImport';
import { FolderField, ImportOptionsRows } from './importWidgets';
import { ScanOptionsRows } from './ScanOptionsRows';

/** Import Manager → laser scans: Leica LGSX / E57 cooked to `.tdpp` in the
 *  browser, or `.tdpp` files copied as they are. */
export function ScanSection() {
  // -----------------------------------------------------------------------------
  // Hooks
  // -----------------------------------------------------------------------------

  const [files, setFiles] = useState<File[]>([]);
  const [folder, setFolder] = useState('');
  const picker = useMultiFilePicker('.lgsx,.e57,.tdpp', setFiles);

  // -----------------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------------

  const cooks = files.some((f) => SCAN_SOURCE_RE.test(f.name));
  const formats = [...new Set(files.map((f) => storeFormatOf(f.name)).filter((f) => f !== null))];

  // -----------------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------------

  const handleImport = async () => {
    if (files.length === 0) {
      return;
    }
    await act.importTdpp(files, { folder });
    setFiles([]);
  };

  // -----------------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------------

  return (
    <Collapsible
      title="Import LGSX / E57"
      defaultOpen={false}
      info={
        <>
          Leica <code>.lgsx</code> and <code>.e57</code> scans are cooked in your browser into one <code>.tdpp</code>{' '}
          file each: the point cloud as a streamable octree, the scanner setups and their panorama photos. A big scan
          takes minutes and needs free browser storage of about a third of its size; the work is spread over the{' '}
          <b>Workers</b>. Already cooked <code>.tdpp</code> files (the <b>scan</b> command-line tool) are copied as they
          are. Load the asset from Model Assets, then use the Scans panel to step into a setup and compare the photo
          with the model.
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {picker.element}
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<IconFolderPlus size={14} />}
            onClick={picker.open}
            tooltip="Pick .lgsx / .e57 scans to cook, or cooked .tdpp files (local only — nothing is uploaded)"
            shortcut="assets.scan.pick"
          >
            Select LGSX / E57 file(s)…
          </Button>
          {files.length > 0 && (
            <span className="self-center truncate text-slate-400 text-xs">
              {files.length > 1 ? `${files.length} files` : files[0].name}
            </span>
          )}
        </div>
        {files.length > 0 && (
          <>
            <ImportOptionsRows formats={formats} />
            <FolderField value={folder} onChange={setFolder} />
            {cooks && <ScanOptionsRows />}
            <div className="flex gap-2">
              <Button
                icon={<IconUpload size={14} />}
                onClick={() => void handleImport()}
                tooltip={
                  cooks ? 'Cook the scan(s) into the asset library' : 'Copy the scan file(s) into the asset library'
                }
                shortcut="assets.scan.import"
              >
                Import
              </Button>
              <Button onClick={() => setFiles([])} tooltip="Discard this scan import">
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Collapsible>
  );
}
