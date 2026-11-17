import { Select, type SelectOption } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

const shapeOptions: SelectOption[] = [
  { value: 'knot', label: 'Torus knot' },
  { value: 'box', label: 'Box' },
  { value: 'icosahedron', label: 'Icosahedron' },
];
const opOptions: SelectOption<'append' | 'remove' | 'keep'>[] = [
  { value: 'append', label: 'Append' },
  { value: 'remove', label: 'Remove' },
  { value: 'keep', label: 'Keep' },
];
const tagOptions: SelectOption[] = [
  { value: 'static', label: 'Static', hint: 'baked' },
  { value: 'dynamic', label: 'Dynamic' },
  { value: 'occluder', label: 'Occluder' },
  { value: 'shadow', label: 'Casts shadow' },
  { value: 'billboard', label: 'Billboard', disabled: true },
];
const assetDb = ['Crate', 'Barrel', 'Rock small', 'Rock large', 'Tree pine', 'Lamp post', 'Fence wood', 'Anvil'];
// Fake asset server: 300 ms latency; the query "error" makes it fail.
const searchAssets = (q: string): Promise<SelectOption[]> =>
  new Promise((resolve, reject) =>
    setTimeout(() => {
      if (q.toLowerCase() === 'error') {
        reject(new Error('Asset server unreachable (demo)'));
      } else {
        resolve(
          assetDb
            .filter((a) => a.toLowerCase().includes(q.toLowerCase()))
            .map((a) => ({ value: a.toLowerCase().replace(/ /g, '-'), label: a, hint: 'mesh' })),
        );
      }
    }, 300),
  );

/** Gallery section for Select (single, multi, async search). */
export function SelectDemo() {
  const [shape, setShape] = useState<string | null>('knot');
  const [op, setOp] = useState<'append' | 'remove' | 'keep'>('append');
  const [tagsSel, setTagsSel] = useState<string[]>(['dynamic', 'shadow']);
  const [assets, setAssets] = useState<string[]>([]);
  return (
    <Section
      title="Select"
      note="Single or multi select with optional search and full keyboard support (Enter / Space / ↓ open, arrows move, Enter picks, Escape closes). A single pick closes the list; in multi mode it stays open and each chip has its own ×. Generic over the value union, so a typed option list makes onChange hand back your own literal type instead of a bare string. Takes the shared label props (top / left / split) and its own tooltip + shortcut, so a panel never wraps it in a labelled div. loadOptions switches it to async search (debounced 250 ms; rejections render in the list — try the query 'error'). The hover × clears the value; clearable={false} drops it for a fixed choice that can never be empty."
      props={['SingleSelectProps', 'MultiSelectProps', 'SelectOption', 'LabelledProps']}
      code={`type Op = 'append' | 'remove' | 'keep';

const SHAPES: readonly SelectOption[] = [
  { value: 'knot', label: 'Torus knot' },
  { value: 'box', label: 'Box' },
];
const OPS: readonly SelectOption<Op>[] = [
  { value: 'append', label: 'Append' },
  { value: 'remove', label: 'Remove' },
  { value: 'keep', label: 'Keep' },
];
const TAGS: readonly SelectOption[] = [
  { value: 'static', label: 'Static', hint: 'baked' },
  { value: 'dynamic', label: 'Dynamic' },
  { value: 'billboard', label: 'Billboard', disabled: true },
];
const ASSETS = ['Crate', 'Barrel', 'Rock small', 'Rock large'];
// stands in for a server call — reject (throw) to show the error in the list
const searchAssets = async (q: string): Promise<SelectOption[]> =>
  ASSETS.filter((a) => a.toLowerCase().includes(q.toLowerCase())).map((a) => ({ value: a, label: a, hint: 'mesh' }));

function MeshTags() {
  const [shape, setShape] = useState<string | null>('knot');
  const [op, setOp] = useState<Op>('append');
  const [tags, setTags] = useState<string[]>([]);
  const [assets, setAssets] = useState<string[]>([]);
  return (
    <>
      <Select label="Shape" searchable options={SHAPES} value={shape} onChange={setShape} />
      <Select label="Operator" labelPosition="split" clearable={false}
        options={OPS} value={op} onChange={(v) => v && setOp(v)} />
      <Select label="Tags" labelPosition="left" labelWidth={52} multiple
        options={TAGS} value={tags} onChange={setTags} placeholder="Add tags…" />
      <Select label="Assets" labelPosition="left" labelWidth={52} multiple
        loadOptions={searchAssets} value={assets} onChange={setAssets} />
    </>
  );
}`}
    >
      <Select label="Single, searchable" searchable options={shapeOptions} value={shape} onChange={setShape} />
      <Select
        className="mt-3"
        label="Fixed choice — clearable=false, no ×"
        clearable={false}
        options={opOptions}
        value={op}
        onChange={(v) => v && setOp(v)}
      />
      <Select
        className="mt-3"
        label="Multi"
        multiple
        options={tagOptions}
        value={tagsSel}
        onChange={setTagsSel}
        placeholder="Add tags…"
      />
      <Select
        className="mt-3"
        label="Async search — try “rock”, or “error”"
        multiple
        loadOptions={searchAssets}
        value={assets}
        onChange={setAssets}
        placeholder="Search assets…"
      />
    </Section>
  );
}
