import { IconFolderPlus, IconUpload } from '@tabler/icons-react';
import { Button, Collapsible } from '@treDeSpaceUI/widgets';
import { NO_TDP_FILES } from '../model-assets/scanDirectory';
import { FolderField, ImportCancelRow, ImportOptionsRows, StagingSelectButtons, StagingTree } from './importWidgets';
import { pickTdpFiles, pickTdpFolder } from './staging';
import type { StagedImport } from './useStagedImport';

/** Import Manager → cooked .tdp files (imported verbatim, no cooking). */
export function TdpSection({ si }: { si: StagedImport }) {
  return (
    <Collapsible
      title="Import TDP"
      defaultOpen={false}
      info={
        <>
          Cooked TreDeSpace <code>.tdp</code> files — imported verbatim, no cooking needed (fastest import). Pick
          individual files, one folder, or a whole folder tree; then tick the files you want and Import.
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<IconUpload size={14} />}
            onClick={() => void pickTdpFiles().then(si.stage)}
            tooltip="Pick individual .tdp files to import"
            shortcut="assets.tdp.pickFiles"
          >
            Select files…
          </Button>
          <Button
            icon={<IconFolderPlus size={14} />}
            onClick={() => void pickTdpFolder(false).then(si.stage)}
            tooltip="Pick a folder — .tdp files at its top level only"
            shortcut="assets.tdp.pickFolder"
          >
            Select folder…
          </Button>
          <Button
            icon={<IconFolderPlus size={14} />}
            onClick={() => void pickTdpFolder(true).then(si.stage)}
            tooltip="Pick a folder and scan every subfolder for .tdp files"
            shortcut="assets.tdp.pickFolderSub"
          >
            Folder + subfolders…
          </Button>
        </div>
        {si.staged?.kind === 'tdp' && (
          <>
            {si.staged.tree && (
              <div className="flex flex-wrap gap-2">
                <StagingSelectButtons si={si} />
              </div>
            )}
            <StagingTree si={si} emptyText={NO_TDP_FILES} />
            {!si.staged.tree && (
              <div className="text-[11px] text-slate-500">{si.selectedFiles().length} file(s) staged</div>
            )}
            <ImportOptionsRows />
            <FolderField value={si.folder} onChange={si.setFolder} />
            <ImportCancelRow si={si} tooltip="Import the selected .tdp files into the chosen store" />
          </>
        )}
      </div>
    </Collapsible>
  );
}
