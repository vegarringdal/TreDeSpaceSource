import { IconUpload } from '@tabler/icons-react';
import { Button, FileTree, Select, TextInput } from '@treDeSpaceUI/widgets';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { storesState } from '../../../state/stores/stores.state';
import type { StagedImport } from './useStagedImport';

/** External link, styled for info-popover prose. */
export function ExtLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 underline hover:text-blue-300">
      {children}
    </a>
  );
}

/** True when the import target is decided: temp imports need no store; a KEPT
 *  import requires an explicit store pick (no silent default to main). */
export function useImportTargetReady(): boolean {
  const { importTemp, importStore } = assetsState.use();
  return importTemp || importStore !== '';
}

/** Per-import options shown inside each import section's settings (once a
 *  file/folder is staged): temp/load checkboxes above the store target.
 *  Temp imports (the default) are purged on the next app start, always load
 *  into the viewer, and need no store choice. */
export function ImportOptionsRows() {
  const { importTemp, loadAfterImport, keepCamera, importStore } = assetsState.use();
  const { stores } = storesState.use();

  return (
    <>
      <label
        className="flex cursor-pointer items-center gap-2 text-slate-300 text-xs"
        data-shortcut="assets.importTemp"
        data-tooltip="Session-only import for temp files: always loaded into the viewer, not kept — purged from the store on the next app start"
      >
        <input type="checkbox" checked={importTemp} onChange={(e) => act.setImportTemp(e.target.checked)} />
        Temp import (don’t keep in store)
      </label>
      <label
        className={`flex items-center gap-2 text-xs ${importTemp ? 'text-slate-500' : 'cursor-pointer text-slate-300'}`}
        data-shortcut="assets.loadAfterImport"
        data-tooltip="Load whatever the import produced into the viewer as soon as it finishes — always on for temp imports"
      >
        <input
          type="checkbox"
          checked={importTemp || loadAfterImport}
          disabled={importTemp}
          onChange={(e) => act.setLoadAfterImport(e.target.checked)}
        />
        Load after import
      </label>
      <label
        className="flex cursor-pointer items-center gap-2 text-slate-300 text-xs"
        data-shortcut="assets.keepCamera"
        data-tooltip="Don’t move the camera when the imported models load — keep the current view instead of framing them"
      >
        <input type="checkbox" checked={keepCamera} onChange={(e) => act.setKeepCamera(e.target.checked)} />
        Keep camera
      </label>
      <label className="flex items-center gap-2 text-slate-400 text-xs">
        <span className="w-14 shrink-0">Store</span>
        <div className="min-w-0 flex-1">
          <Select
            value={importTemp ? '' : importStore}
            placeholder="Select store"
            disabled={importTemp}
            options={stores.map((s) => ({ value: s.name, label: s.name }))}
            onChange={(v) => act.setImportStore(v ?? '')}
          />
        </div>
      </label>
    </>
  );
}

/** Folder-name input line used by every import section. */
export function FolderField({
  value,
  onChange,
  labelWidth = 'w-14',
  disabled = false,
  placeholder = '(none)',
}: {
  value: string;
  onChange: (v: string) => void;
  labelWidth?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-slate-400 text-xs">
      <span className={`${labelWidth} shrink-0`}>Folder</span>
      <TextInput value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} />
    </label>
  );
}

/** Select-all / deselect-all over the staged files. */
export function StagingSelectButtons({ si }: { si: StagedImport }) {
  return (
    <>
      <Button
        className="h-auto min-h-6 flex-1 py-1 leading-tight"
        onClick={() => si.setTreeSel(new Set(si.allPaths()))}
        tooltip="Select every staged file"
        shortcut="assets.staging.selectAll"
      >
        Select all
      </Button>
      <Button
        className="h-auto min-h-6 flex-1 py-1 leading-tight"
        disabled={si.treeSel.size === 0}
        onClick={() => si.setTreeSel(new Set())}
        tooltip="Clear the staging selection"
        shortcut="assets.staging.deselectAll"
      >
        Deselect all
      </Button>
    </>
  );
}

/** The staged tree + selection hint (tree stagings only). */
export function StagingTree({ si, emptyText }: { si: StagedImport; emptyText: string }) {
  if (!si.staged?.tree) {
    return null;
  }

  return (
    <>
      <FileTree root={si.staged.tree} selected={si.treeSel} onSelect={si.setTreeSel} emptyText={emptyText} />
      <div className="text-[11px] text-slate-500">
        {si.selectedFiles().length} selected — click to select, Ctrl toggles, Shift ranges, click a folder to expand
        (Ctrl+click selects its subtree)
      </div>
    </>
  );
}

/** Import / Cancel row for the staged sections. Import stays disabled until
 *  the target is decided (temp, or an explicitly chosen store). */
export function ImportCancelRow({ si, tooltip }: { si: StagedImport; tooltip: string }) {
  const targetReady = useImportTargetReady();

  if (!si.staged) {
    return null;
  }

  return (
    <div className="flex gap-2">
      <Button
        icon={<IconUpload size={14} />}
        disabled={si.selectedFiles().length === 0 || !targetReady}
        onClick={() => void si.doImport()}
        tooltip={targetReady ? tooltip : 'Pick a store first (or tick Temp import)'}
      >
        Import{si.staged.tree ? ` (${si.selectedFiles().length})` : ''}
      </Button>
      <Button onClick={si.clear} tooltip="Discard this import">
        Cancel
      </Button>
    </div>
  );
}
