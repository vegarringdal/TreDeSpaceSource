import { IconDeviceFloppy, IconFolderOpen } from '@tabler/icons-react';
import { Button, Collapsible, Select, useFilePicker } from '@treDeSpaceUI/widgets';
import { useEffect } from 'react';
import { useLoadedStores } from '../../../state/viewer/storeScope';
import { exportState } from './export.state';
import { registerSnapshotLoad } from './exportPanel';
import { SnapshotCheck } from './SnapshotCheck';
import { snapshotActions as act } from './snapshot.actions';

/** A "Store" scope row for save/apply: All stores ('' ) or one loaded store. */
function StoreScopeRow({ field, tooltip }: { field: 'snapStore' | 'snapApplyStore'; tooltip: string }) {
  const value = exportState.use()[field];
  const loadedStores = useLoadedStores();
  const options = [
    { value: '', label: 'All stores' },
    ...loadedStores.map((s) => ({ value: s, label: s })),
    ...(value && !loadedStores.includes(value) ? [{ value, label: value }] : []),
  ];
  return (
    <label className="flex items-center gap-2 text-slate-300 text-xs" data-tooltip={tooltip}>
      <span className="w-14 shrink-0 text-slate-400">Store</span>
      <div className="w-40">
        <Select options={options} value={value} onChange={(v) => exportState.set({ [field]: v ?? '' })} />
      </div>
    </label>
  );
}

/** Export → State snapshot: save/load the per-item color, opacity, visibility
 *  and transform state as one compact .tdsnap file (no geometry). */
export function ExportSnapshotSection() {
  const picker = useFilePicker('.tdsnap', (f) => void act.load(f));

  // let the export.snapLoad hotkey pop the picker even from outside the panel
  useEffect(() => {
    registerSnapshotLoad(picker.open);
    return () => registerSnapshotLoad(null);
  }, [picker.open]);

  return (
    <Collapsible
      title="State snapshot"
      info={
        <>
          Saves the current <b>coloring, opacity, visibility and transforms</b> — no geometry — as one compact .tdsnap
          file, even for huge scenes. Loading it back restores that state onto the loaded models.
          <br />
          <br />
          Items are matched by a stable hash of their <b>fullname</b> within each model&apos;s folder + file, so a
          snapshot keeps working across reloads and re-imports as long as names and folders stay the same. Loading
          <b> replaces</b> the selected channels and clears their undo history.
        </>
      }
    >
      <SnapshotCheck
        field="snapModifiedOnly"
        label="Only modified items"
        shortcut="export.snapModifiedOnly"
        tooltip="Save only items with an override, hidden flag or transform — untick to record every item's current state (bigger file, can repaint another dataset)"
      />
      <SnapshotCheck
        field="snapColor"
        label="Save colors & visibility"
        shortcut="export.snapColor"
        tooltip="Include color, opacity and hidden state in the saved snapshot"
      />
      <SnapshotCheck
        field="snapTransform"
        label="Save transforms"
        shortcut="export.snapTransform"
        tooltip="Include moved/rotated/scaled item transforms in the saved snapshot"
      />
      <SnapshotCheck
        field="snapSkipWhite"
        label="Skip white (#ffffff)"
        shortcut="export.snapSkipWhite"
        tooltip="Leave plain white out of the file — it is the unpainted default, so skipping it shrinks the snapshot a lot (a translucent white is still saved)"
      />
      <SnapshotCheck
        field="snapSkipHidden"
        label="Skip hidden state"
        shortcut="export.snapSkipHidden"
        tooltip="Do not record which items are hidden, so loading this snapshot never hides anything"
      />
      <StoreScopeRow
        field="snapStore"
        tooltip="Save only models loaded from one store (plant) — All stores snapshots the whole scene"
      />
      <Button
        icon={<IconDeviceFloppy size={14} />}
        tooltip="Write the selected state channels of every loaded model into one .tdsnap file and download it"
        shortcut="export.snapSave"
        onClick={() => void act.save()}
      >
        Save snapshot
      </Button>
      <SnapshotCheck
        field="snapApplyColor"
        label="Load colors & visibility"
        shortcut="export.snapApplyColor"
        tooltip="Apply the file's color, opacity and hidden state (replaces the current coloring)"
        className="mt-1"
      />
      <SnapshotCheck
        field="snapApplyTransform"
        label="Load transforms"
        shortcut="export.snapApplyTransform"
        tooltip="Apply the file's transforms (replaces the current transforms)"
      />
      <SnapshotCheck
        field="snapApplySkipWhite"
        label="Skip white (#ffffff)"
        shortcut="export.snapApplySkipWhite"
        tooltip="Ignore plain white in the file — those items keep their original color instead of being painted white"
      />
      <SnapshotCheck
        field="snapApplySkipHidden"
        label="Skip hidden state"
        shortcut="export.snapApplySkipHidden"
        tooltip="Ignore the file's hidden state — nothing gets hidden, only colors and opacity are applied"
      />
      <StoreScopeRow
        field="snapApplyStore"
        tooltip="Apply only onto models of one store (plant) — other stores are left untouched; also lets a snapshot saved from one plant retarget onto another with the same structure"
      />
      <Button
        icon={<IconFolderOpen size={14} />}
        tooltip="Pick a .tdsnap file and apply its state to the loaded models (replaces the selected channels)"
        shortcut="export.snapLoad"
        onClick={picker.open}
      >
        Load snapshot…
      </Button>
      {picker.element}
    </Collapsible>
  );
}
