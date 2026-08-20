import { Button, Checkbox, Select, TextInput, useFilePicker } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Hint } from '../components/Hint';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { must } from '../util';
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
  const storeOptions = stores.map((s) => ({ value: s.name, label: `${s.name} (${s.count})` }));

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

  const handleImportUrl = () => {
    const u = url.trim();
    if (!u) {
      line('err', 'enter a database URL');
      return;
    }

    void run('sql.importUrl', { files: [{ url: u }], store, replace }, () =>
      c().sqlImportUrl({ files: [{ url: u }], store, replace }),
    );
  };

  // the picked File rides straight to the SDK as a Blob (read + transferred there)
  const handleImport = () => {
    if (!file) {
      line('err', 'pick a database file first');
      return;
    }

    void run('sql.import', { fileName: file.name, store, replace, bytes: `<${file.size} bytes>` }, () =>
      c().sqlImport({ fileName: file.name, bytes: file, store, replace }),
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
        import-time md5 shows up in sql.list; hash your hosted file and compare to skip unchanged imports.
      </Hint>
      <Row>
        <TextInput value={url} onChange={setUrl} placeholder="https://…/meta.db" className="min-w-0 flex-1" />
        <Button onClick={handleImportUrl}>sql.importUrl</Button>
      </Row>
      <SqlQueryPanel dbs={dbs} mainDb={mainDb} onMainDbChange={setMainDb} />
    </DemoSection>
  );
}
