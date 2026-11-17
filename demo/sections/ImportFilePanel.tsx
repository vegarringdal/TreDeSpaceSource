import { Button, Checkbox, Select, useFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import type { ImportFormat } from '../../api/tredespace-client';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { IMPORT_FORMAT_OPTIONS, must, toImportFormat } from '../util';

type ImportFilePanelProps = Readonly<{
  store?: string;
  replace: boolean;
  onReplaceChange: (replace: boolean) => void;
}>;

/** File import into the selected store. The picked File is passed straight to
 *  the SDK as a Blob — never read into one big ArrayBuffer — so files >2 GB
 *  import fine: the SDK auto-streams anything >=500 MB in 64 MB chunks. */
export function ImportFilePanel({ store, replace, onReplaceChange }: ImportFilePanelProps) {
  const { run, c, line } = useDemo();
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<ImportFormat>('glb-standard');
  const picker = useFilePicker('.glb,.rvm,.ifc,.stp,.step', setFile);

  // throttle the chunked-upload progress log to whole-percent steps
  const onProgress = () => {
    let last = -1;
    return (f: number) => {
      const pct = Math.floor(f * 100);
      if (pct !== last) {
        last = pct;
        line('', `  … uploading ${pct}%`);
      }
    };
  };

  const importOpts = (f: File) => ({
    fileName: f.name,
    format,
    bytes: f,
    store,
    replace,
    options: { normals: true, edges: true },
    onProgress: onProgress(),
  });

  const requireFile = (): File | null => {
    if (!file) {
      line('err', 'pick a file first');
    }

    return file;
  };

  const handleFormatChange = (v: string | null) => {
    const f = toImportFormat(v);
    if (f) {
      setFormat(f);
    }
  };

  const handleImport = () => {
    const f = requireFile();
    if (!f) {
      return;
    }

    void run('assets.import', { fileName: f.name, format, store, replace, bytes: `<${f.size} bytes>` }, () =>
      c().assetsImport(importOpts(f)),
    );
  };

  // import + load in one go — "import a sample and show it"
  const handleImportLoad = () => {
    const f = requireFile();
    if (!f) {
      return;
    }

    void run('assets.import + load', { fileName: f.name, format, store }, () => c().assetsImportAndLoad(importOpts(f)));
  };

  // session model: import → load → remove the local asset. The model stays on
  // screen but nothing is left in local storage (gone on reload).
  const handleSession = () => {
    const f = requireFile();
    if (!f) {
      return;
    }

    void run('assets.import + load + remove (session)', { fileName: f.name, format, store }, async () => {
      const imp = must(await c().assetsImportAndLoad(importOpts(f)));
      const ids = imp.entries.map((e) => e.id);
      const removed = must(await c().assetsRemove(ids, { store }));
      return {
        data: { loaded: imp.loaded, removed: removed.removed, note: 'model kept on screen; local assets erased' },
      };
    });
  };

  return (
    <>
      <Hint>Import into the selected store:</Hint>
      {picker.element}
      <Row>
        <Button onClick={picker.open}>Choose file…</Button>
        <span className="min-w-0 truncate text-slate-400">{file ? file.name : 'no file picked'}</span>
      </Row>
      <Row>
        <Select value={format} onChange={handleFormatChange} options={IMPORT_FORMAT_OPTIONS} className="min-w-32" />
        <Button onClick={handleImport}>assets.import</Button>
        <Button onClick={handleImportLoad}>import + load</Button>
        <Button onClick={handleSession}>import + load + remove (session)</Button>
      </Row>
      <Checkbox
        checked={replace}
        onChange={onReplaceChange}
        label="replace if exists"
        hint="delete prior asset with same store / folder / name"
      />
    </>
  );
}
