import { Button, Collapsible, Select, TextArea } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { labelsActions as act } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { useLoadedStores } from '../../../state/viewer/storeScope';

/** Labels → Import tags: paste tag names, append or replace as labels. */
export function LabelsImportSection() {
  const [paste, setPaste] = useState('');
  const [importing, setImporting] = useState(false);
  const { snapToItem, importStore } = labelsState.use();
  const loadedStores = useLoadedStores();
  const storeOptions = [
    { value: '', label: 'All stores' },
    // only stores with models in the scene; keep a stale pick selectable
    ...loadedStores.map((s) => ({ value: s, label: s })),
    ...(importStore && !loadedStores.includes(importStore) ? [{ value: importStore, label: importStore }] : []),
  ];

  const runImport = (mode: 'append' | 'replace') => {
    if (importing || !paste.trim()) {
      return;
    }
    setImporting(true);
    void act
      .importTags(paste, mode)
      .then((notFound) => setPaste(notFound.length ? `Not found:\n${notFound.join('\n')}` : ''))
      .finally(() => setImporting(false));
  };

  return (
    <Collapsible title="Import tags" defaultOpen={false}>
      <TextArea
        value={paste}
        rows={6}
        placeholder={'Paste tag names — one per line\n/A-82BB010A-509-Q01\nA-82BB010B-705-Q04'}
        onChange={setPaste}
      />
      <label
        className="flex cursor-pointer items-center gap-2 text-slate-300 text-xs"
        title="A tag with children anchors at its bounding-box center — on a bent pipe run that point hangs in empty air. This snaps the anchor to the nearest child item instead. (Hotkey: Labels: snap anchors to items)"
      >
        <input type="checkbox" checked={snapToItem} onChange={(e) => act.setSnapToItem(e.target.checked)} />
        Snap anchor to nearest item
      </label>
      <label
        className="flex items-center gap-2 text-slate-300 text-xs"
        data-tooltip="Resolve tags only among models loaded from one store — All stores searches every loaded model"
      >
        <span className="w-14 shrink-0 text-slate-400">Store</span>
        <div className="w-40">
          <Select options={storeOptions} value={importStore} onChange={(v) => act.setImportStore(v ?? '')} />
        </div>
      </label>
      <div className="flex items-center gap-1.5">
        <Button
          disabled={importing || !paste.trim()}
          tooltip="Add labels for these tags (existing labels are kept; duplicates skipped)"
          shortcut="labels.import.append"
          onClick={() => runImport('append')}
        >
          Append
        </Button>
        <Button
          disabled={importing || !paste.trim()}
          tooltip="Delete all labels, then add labels for these tags"
          shortcut="labels.import.replace"
          onClick={() => runImport('replace')}
        >
          Replace
        </Button>
      </div>
      <div className="text-slate-500 text-xs">
        Tags match the model fullname, with or without the leading “/”. Anything not found is written back above.
      </div>
    </Collapsible>
  );
}
