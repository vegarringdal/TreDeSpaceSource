import { Button, Checkbox, Collapsible, Select, TextArea } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { labelsActions as act } from '../../../state/viewer/labels.actions';
import { labelsState } from '../../../state/viewer/labels.state';
import { useLoadedStores } from '../../../state/viewer/storeScope';

/** Labels → Import tags: paste tag names, append or replace as labels. */
export function LabelsImportSection() {
  const [paste, setPaste] = useState('');
  const [importing, setImporting] = useState(false);
  const { snapToItem, importStore, importStripSlash } = labelsState.use();
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
      <Checkbox
        label="Snap anchor to nearest item"
        checked={snapToItem}
        onChange={act.setSnapToItem}
        shortcut="labels.import.snap"
        tooltip="A tag with children anchors at its bounding-box center — on a bent pipe run that point hangs in empty air. This snaps the anchor to the nearest child item instead."
      />
      <Checkbox
        label="Label text without leading /"
        checked={importStripSlash}
        onChange={act.setImportStripSlash}
        shortcut="labels.import.stripSlash"
        tooltip="Show the tag without the model's leading “/” in the label itself. The label stays linked to the full name, so selection, colouring and viewpoints still match."
      />
      <Select
        label="Store"
        labelPosition="left"
        labelWidth={56}
        options={storeOptions}
        value={importStore}
        tooltip="Resolve tags only among models loaded from one store — All stores searches every loaded model"
        onChange={(v) => act.setImportStore(v ?? '')}
      />
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
