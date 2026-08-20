import { IconTrash } from '@tabler/icons-react';
import { Button, Collapsible, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { storesActions } from '../../../state/stores/stores.actions';
import { MAIN_STORE, storesState } from '../../../state/stores/stores.state';
import { dialogs } from '../../dialogs/dialogs.actions';

/** Label separating Store Config from the store list — shared by Model Assets
 *  and SQL Assets. Pinned above the scrolling list so it stays visible. */
export function DataStoresHeader() {
  return <div className="border-slate-800 border-b pb-1 text-slate-400 text-xs">Data Stores</div>;
}

/** Store Config: create/remove stores — SHARED by the Model Assets and SQL Assets
 *  panels. A store splits both libraries by project: it is a real directory
 *  under model_assets/ and sql_assets/, a titled section in both panels, and
 *  the import target in the Import Manager. Editing it in one panel changes
 *  it in the other. */
export function StoreAdmin() {
  const { stores } = storesState.use();
  const extra = stores.filter((s) => s.name !== MAIN_STORE);

  return (
    <Collapsible
      title="Store Config"
      defaultOpen={false}
      info={
        <>
          Stores split the library into separate projects — models <i>and</i> databases. <b>main</b> always exists. A
          store's name is its section title in both asset panels, its import target in the Import Manager, and its
          folder name on disk (<code>sql_assets/&lt;store&gt;/</code>).
        </>
      }
    >
      <NewStoreForm />
      {extra.map((s) => (
        <div key={s.name} className="flex flex-col gap-1 border border-slate-800 p-1.5">
          <div className="flex items-center gap-1.5">
            <span className="flex-1 truncate font-medium text-slate-200 text-xs">{s.name}</span>
            <Button
              icon={<IconTrash size={14} />}
              tooltip="Delete this store — every model AND database in it is deleted"
              onClick={() => {
                void dialogs
                  .confirm(`Delete store "${s.name}" with all its models and databases?`, { okLabel: 'Delete store' })
                  .then((ok) => {
                    if (ok) {
                      void storesActions.removeStore(s.name);
                    }
                  });
              }}
            />
          </div>
          <TextInput
            value={s.description}
            placeholder="Description"
            onChange={(v) => void storesActions.updateStore(s.name, { description: v })}
          />
        </div>
      ))}
    </Collapsible>
  );
}

function NewStoreForm() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = () => {
    if (!name.trim()) {
      return;
    }
    void storesActions.addStore(name, description);
    setName('');
    setDescription('');
  };

  return (
    <div className="flex flex-col gap-1.5 border border-slate-800 p-1.5">
      <TextInput value={name} onChange={setName} placeholder="New store name" />
      <TextInput value={description} onChange={setDescription} placeholder="Description (shown in the section)" />
      <Button className="self-start" shortcut="assets.store.add" tooltip="Create a new store" onClick={create}>
        Add store
      </Button>
    </div>
  );
}
