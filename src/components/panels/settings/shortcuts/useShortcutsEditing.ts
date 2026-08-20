import { formatSequence, hotkeysActions, hotkeysState, recordSequence, type Sequence } from '@treDeSpaceUI/hotkeys';
import { readFileText, useFilePicker } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { downloadText } from '../../../../lib/download';
import { dialogs } from '../../../dialogs/dialogs.actions';
import { consoleActions } from '../../console/console.actions';

type ShortcutsEditing = Readonly<{
  recordingId: string | null;
  record: (id: string) => Promise<void>;
  doExport: () => void;
  picker: { element: ReactNode; open: () => void };
}>;

/** Editing side of the Shortcuts settings: record a sequence (with conflict
 *  reassignment), and JSON export/import via a hidden file picker. */
export function useShortcutsEditing(): ShortcutsEditing {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const picker = useFilePicker('application/json,.json', (f) => readFileText(f, doImportText));

  const record = async (id: string) => {
    setRecordingId(id);
    try {
      const seq = await recordSequence();
      await applyRecorded(id, seq);
    } catch {
      // cancelled / empty — leave unchanged
    } finally {
      setRecordingId(null);
    }
  };

  const doExport = () => downloadText('keymap.json', hotkeysActions.exportJson());

  return { recordingId, record, doExport, picker };
}

/** Assign a recorded sequence, first stealing it from any conflicting hotkey
 *  (with a confirm dialog) so no two ids share a binding. */
async function applyRecorded(id: string, seq: Sequence): Promise<void> {
  const { defs } = hotkeysState.get();
  const clash = hotkeysActions.conflictsFor(seq, id);
  if (clash.length > 0) {
    const owner = defs[clash[0]]?.label ?? clash[0];
    const ok = await dialogs.confirm(
      `${formatSequence(seq)} is already used by "${owner}". Reassign it to "${defs[id]?.label ?? id}"?`,
      { okLabel: 'Reassign' },
    );
    if (!ok) {
      return;
    }

    for (const loser of clash) {
      hotkeysActions.resetOne(loser); // no duplicates
    }
  }
  hotkeysActions.setOverride(id, seq);
  consoleActions.log('info', `⌨ Recorded "${defs[id]?.label ?? id}" → ${formatSequence(seq)}`);
}

function doImportText(text: string): void {
  try {
    const r = hotkeysActions.importJson(text);
    void dialogs.confirm(
      `Imported ${r.applied.length} shortcut(s).` +
        (r.conflicts.length ? ` ${r.conflicts.length} skipped (conflict).` : '') +
        (r.skipped.length ? ` ${r.skipped.length} skipped (unknown/invalid).` : ''),
      { okLabel: 'OK' },
    );
  } catch (e) {
    void dialogs.confirm(`Import failed: ${e instanceof Error ? e.message : String(e)}`, { okLabel: 'OK' });
  }
}
