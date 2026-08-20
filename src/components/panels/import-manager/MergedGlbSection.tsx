import { IconFolderPlus } from '@tabler/icons-react';
import { Button, Collapsible, NumberInput } from '@treDeSpaceUI/widgets';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { NO_IMPORTABLE_FILES } from '../model-assets/scanDirectory';
import {
  ExtLink,
  FolderField,
  ImportCancelRow,
  ImportOptionsRows,

  StagingSelectButtons,
  StagingTree,
} from './importWidgets';
import { pickFolder } from './staging';
import type { StagedImport } from './useStagedImport';

/** Import Manager → merged rvm2glb files (cooked to .tdp on import). */
export function MergedGlbSection({ si }: { si: StagedImport }) {
  const { pool } = assetsState.use();

  return (
    <Collapsible
      title="Import merged glb"
      defaultOpen={false}
      info={
        <>
          <ExtLink href="https://github.com/vegarringdal/rvm2glb">rvm2glb</ExtLink> <b>merged</b> files only — a single
          mesh stream per hierarchy root. Standard and gpu-instanced glTF goes through <b>Import standard GLB</b> below
          instead. Pick a folder, tick the files you want, then Import; each file is cooked to a <code>.tdp</code>{' '}
          (TreDeSpace model) in the chosen store.
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<IconFolderPlus size={14} />}
            onClick={() => void pickFolder().then(si.stage)}
            tooltip="Scan a folder tree and pick files to import (dot-folders are skipped)"
            shortcut="assets.importFolder"
          >
            Select folder…
          </Button>
          {si.staged?.kind === 'glb' && <StagingSelectButtons si={si} />}
        </div>
        {si.staged?.kind === 'glb' && (
          <>
            <StagingTree si={si} emptyText={NO_IMPORTABLE_FILES} />
            <ImportOptionsRows />
            <FolderField value={si.folder} onChange={si.setFolder} />
            <label className="flex items-center gap-2 text-slate-400 text-xs">
              <span className="w-14 shrink-0">Pool</span>
              <div className="w-24">
                <NumberInput
                  value={pool}
                  min={1}
                  max={10}
                  step={1}
                  onChange={act.setPool}
                  decShortcut="assets.pool.dec"
                  incShortcut="assets.pool.inc"
                />
              </div>
              <span className="text-slate-500">parallel cooks</span>
            </label>
            <ImportCancelRow si={si} tooltip="Import the selected files (GLBs are cooked)" />
          </>
        )}
      </div>
    </Collapsible>
  );
}
