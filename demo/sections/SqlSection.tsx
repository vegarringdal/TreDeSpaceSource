import { Button, Checkbox, Select, TextArea, useFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { must, splitLines } from '../util';
import { SqlColorPanel } from './SqlColorPanel';
import { SqlQueryPanel } from './SqlQueryPanel';

export function SqlSection() {
  const { run, c, line, stores, setStores } = useDemo();
  const [selected, setSelected] = useState<string | null>(null);
  const [replace, setReplace] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [dbs, setDbs] = useState<readonly string[]>([]);
  const [mainDb, setMainDb] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const picker = useFilePicker('.db,.sqlite,.sqlite3,.db3,.sqlite-db', setFile);

  const store = selected ?? undefined;
  // sqlCount is what matters here; stores.list also reports modelCount + the total
  const storeOptions = stores.map((s) => ({ value: s.name, label: `${s.name} (${s.sqlCount} db)` }));

  const handleStoresList = () => {
    void run('stores.list', {}, async () => {
      const res = await c().storesList();
      if (res.data) {
        setStores(res.data.stores);
      }

      return res;
    });
  };

  const handleList = () => {
    void run('sql.list', { store }, async () => {
      const res = await c().sqlList(store);
      if (res.data) {
        const paths = res.data.dbs.map((d) => d.path);
        setDbs(paths);
        setMainDb((prev) => (prev != null && paths.includes(prev) ? prev : (paths[0] ?? null)));
      }

      return res;
    });
  };

  const handleDelete = () => {
    void run('sql.delete', { store, paths: '(all in store)' }, async () => {
      const list = must(await c().sqlList(store));
      return c().sqlDelete(list.dbs.map((d) => d.path));
    });
  };

  // one line per file, rewritten as the percentage climbs — "fetching X/Y"
  // plus the download percent of the file in flight
  const handleImportUrl = () => {
    const urls = splitLines(url);
    if (!urls.length) {
      line('err', 'enter at least one database URL (one per line)');
      return;
    }

    const files = urls.map((u) => ({ url: u, meta: { importedBy: 'demo', at: Date.now() } }));
    void run('sql.importUrl', { files, store, replace }, () =>
      c().sqlImportUrl({
        files,
        store,
        replace,
        onProgress: (p) => {
          const pct = p.totalBytes ? ` ${Math.round(((p.loaded ?? 0) / p.totalBytes) * 100)}%` : '';
          line('', `  … fetching file ${p.completed + 1}/${p.total} — ${p.fileName} ${p.phase}${pct}`);
        },
      }),
    );
  };

  // the picked File rides straight to the SDK as a Blob (read + transferred there)
  const handleImport = () => {
    if (!file) {
      line('err', 'pick a database file first');
      return;
    }

    void run('sql.import', { fileName: file.name, store, replace, bytes: `<${file.size} bytes>` }, () =>
      c().sqlImport({
        fileName: file.name,
        bytes: file,
        store,
        replace,
        meta: { importedBy: 'demo', at: Date.now() },
        onProgress: (p) => line('', `  … ${p.fileName} ${p.phase}`),
      }),
    );
  };

  return (
    <DemoSection
      title="Stores & assets — SQL"
      info="SQLite databases in OPFS (sql_assets/<store>/<file>) — stores are shared with Model Assets. Fetch stores
        first, then list / import / query databases in that store. sql.list populates the main-db dropdown that
        sql.query runs against; ATTACH other dbs inline by their OPFS path."
    >
      <Row>
        <Button onClick={handleStoresList}>stores.list</Button>
        <Select
          value={selected}
          onChange={setSelected}
          options={storeOptions}
          placeholder="(fetch stores first)"
          className="min-w-40"
        />
      </Row>
      <Row>
        <Button onClick={handleList}>sql.list (store)</Button>
        <Button onClick={handleDelete}>sql.delete (all in store)</Button>
      </Row>
      <Hint>Import a database into the selected store:</Hint>
      {picker.element}
      <Row>
        <Button onClick={picker.open}>Choose file…</Button>
        <span className="min-w-0 truncate text-slate-400">{file ? file.name : 'no file picked'}</span>
      </Row>
      <Row>
        <Button onClick={handleImport}>sql.import</Button>
        <Checkbox checked={replace} onChange={setReplace} label="replace if exists" />
      </Row>
      <Hint>
        Or let the viewer download it by URL — streamed straight into OPFS (GB-safe, nothing rides postMessage). The
        import-time md5 shows up in sql.list; hash your hosted file and compare to skip unchanged imports. Progress
        ticks report "file X/Y" plus the download percent, and the demo attaches a <code>meta</code> object you can see
        again in sql.list.
      </Hint>
      <Row>
        <TextArea value={url} onChange={setUrl} rows={2} placeholder="https://…/meta.db (one URL per line)" />
        <Button onClick={handleImportUrl}>sql.importUrl</Button>
      </Row>
      <SqlQueryPanel dbs={dbs} mainDb={mainDb} onMainDbChange={setMainDb} />
      <SqlColorPanel mainDb={mainDb} />
    </DemoSection>
  );
}
