import { IconUpload } from '@tabler/icons-react';
import { Button, Checkbox, FileTree, Select, TextInput } from '@treDeSpaceUI/widgets';
import { assetsActions as act } from '../../../state/assets/assets.actions';
import { assetsState } from '../../../state/assets/assets.state';
import { storesState } from '../../../state/stores/stores.state';
import type { StagedImport } from './useStagedImport';

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
      <Checkbox
        label="Temp import (don’t keep in store)"
        checked={importTemp}
        onChange={act.setImportTemp}
        shortcut="assets.importTemp"
        tooltip="Session-only import for temp files: always loaded into the viewer, not kept — purged from the store on the next app start"
      />
      <Checkbox
        label="Load after import"
        checked={importTemp || loadAfterImport}
        disabled={importTemp}
        onChange={act.setLoadAfterImport}
        shortcut="assets.loadAfterImport"
        tooltip="Load whatever the import produced into the viewer as soon as it finishes — always on for temp imports"
      />
      <Checkbox
        label="Keep camera"
        checked={keepCamera}
        onChange={act.setKeepCamera}
        shortcut="assets.keepCamera"
        tooltip="Don’t move the camera when the imported models load — keep the current view instead of framing them"
      />
      <Select
        label="Store"
        labelPosition="left"
        labelWidth={56}
        value={importTemp ? '' : importStore}
        placeholder="Select store"
        disabled={importTemp}
        options={stores.map((s) => ({ value: s.name, label: s.name }))}
        onChange={(v) => act.setImportStore(v ?? '')}
      />
    </>
  );
}

/** Folder-name input line used by every import section. */
export function FolderField({
  value,
  onChange,
  labelWidth = 56,
  disabled = false,
  placeholder = '(none)',
  tooltip,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Label column width in px — share one value across an option form. */
  labelWidth?: number;
  disabled?: boolean;
  placeholder?: string;
  /** Styled tooltip on the row (e.g. why the field is disabled). */
  tooltip?: string;
}) {
  return (
    <TextInput
      label="Folder"
      labelPosition="left"
      labelWidth={labelWidth}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      tooltip={tooltip}
    />
  );
}

/** Select-all / deselect-all over the staged files. */
export function StagingSelectButtons({ si }: { si: StagedImport }) {
  return (
    <>
      <Button
        wrap
        grow
        onClick={() => si.setTreeSel(new Set(si.allPaths()))}
        tooltip="Select every staged file"
        shortcut="assets.staging.selectAll"
      >
        Select all
      </Button>
      <Button
        wrap
        grow
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
