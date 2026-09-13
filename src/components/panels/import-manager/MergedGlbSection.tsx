import { IconFolderPlus } from '@tabler/icons-react';
import { Button, Collapsible, Link, NumberInput } from '@treDeSpaceUI/widgets';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { workerPoolCap } from '../../../state/assets/workerPoolCap';
import { NO_IMPORTABLE_FILES } from '../model-assets/scanDirectory';
import { FolderField, ImportCancelRow, ImportOptionsRows, StagingSelectButtons, StagingTree } from './importWidgets';
import { pickFolder } from './staging';
import type { StagedImport } from './useStagedImport';

/** Import Manager → merged rvm2glb files (cooked to .tdp on import). */
export function MergedGlbSection({ si }: { si: StagedImport }) {
  const { pool } = assetsState.use();
  const poolCap = workerPoolCap();

  return (
    <Collapsible
      title="Import merged glb"
      defaultOpen={false}
      info={
        <>
          <Link href="https://github.com/vegarringdal/rvm2glb">rvm2glb</Link> <b>merged</b> files only — a single mesh
          stream per hierarchy root. Standard and gpu-instanced glTF goes through <b>Import standard GLB</b> below
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
            <NumberInput
              label="Pool"
              labelPosition="left"
              labelWidth={56}
              unit="parallel cooks"
              value={pool}
              min={1}
              max={poolCap}
              step={1}
              tooltip={`Cooker workers run at once (max ${poolCap} on this machine: one per core, one left for the UI). Each holds a whole GLB while it cooks.`}
              onChange={act.setPool}
              decShortcut="assets.pool.dec"
              incShortcut="assets.pool.inc"
            />
            <ImportCancelRow si={si} tooltip="Import the selected files (GLBs are cooked)" />
          </>
        )}
      </div>
    </Collapsible>
  );
}
