import { Button, Select, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { DemoSection } from '../components/DemoSection';
import { Row } from '../components/Row';
import { useDemo } from '../DemoContext';
import { must } from '../util';
import { ImportFilePanel } from './ImportFilePanel';
import { ImportUrlPanel } from './ImportUrlPanel';

export function ModelStoresSection() {
  const { run, c, line, stores, setStores } = useDemo();
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [replace, setReplace] = useState(true);

  const store = selected ?? undefined;
  const storeOptions = stores.map((s) => ({ value: s.name, label: `${s.name} (${s.count})` }));

  const handleList = () => {
    void run('stores.list', {}, async () => {
      const res = await c().storesList();
      if (res.data) {
        setStores(res.data.stores);
      }

      return res;
    });
  };

  // stores are shared between the Model and SQL sections, so one refresh of
  // the shared registry updates both dropdowns
  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      line('err', 'enter a store name');
      return;
    }

    void run('stores.create', { name: trimmed, description: desc }, async () => {
      const res = await c().storesCreate(trimmed, { description: desc });
      const list = await c().storesList();
      if (list.data) {
        setStores(list.data.stores);
      }

      return res;
    });
  };

  const handleLoad = () => {
    void run('assets.load', { store, ids: '(all unloaded in store)' }, async () => {
      const { assets } = must(await c().assetsList(store));
      const ids = assets.filter((a) => !a.loaded).map((a) => a.id);
      return c().assetsLoad(ids, { store });
    });
  };

  const handleUnload = () => {
    void run('assets.unload', { store, ids: '(all loaded in store)' }, async () => {
      const { assets } = must(await c().assetsList(store));
      const ids = assets.filter((a) => a.loaded).map((a) => a.id);
      return c().assetsUnload(ids);
    });
  };

  return (
    <DemoSection
      title="Stores & assets — Model"
      info="Fetch stores first (stores.list) to populate the dropdown, then list / load / import target that store —
        the API rejects an unknown store name with a not-found error."
    >
      <Row>
        <Button onClick={handleList}>stores.list</Button>
        <Select
          value={selected}
          onChange={setSelected}
          options={storeOptions}
          placeholder="(fetch stores first)"
          className="min-w-40"
        />
      </Row>
      <Row>
        <TextInput value={name} onChange={setName} placeholder="new store name" className="min-w-0 flex-1" />
        <TextInput value={desc} onChange={setDesc} placeholder="description (optional)" className="min-w-0 flex-1" />
        <Button onClick={handleCreate}>stores.create</Button>
      </Row>
      <Row>
        <Button onClick={() => void run('assets.list', { store }, () => c().assetsList(store))}>
          assets.list (store)
        </Button>
        <Button onClick={handleLoad}>assets.load (all in store)</Button>
        <Button onClick={handleUnload}>assets.unload (all loaded)</Button>
      </Row>
      <ImportFilePanel store={store} replace={replace} onReplaceChange={setReplace} />
      <ImportUrlPanel store={store} replace={replace} />
    </DemoSection>
  );
}
