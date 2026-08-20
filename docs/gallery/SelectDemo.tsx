import { Select, type SelectOption } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

const shapeOptions: SelectOption[] = [
  { value: 'knot', label: 'Torus knot' },
  { value: 'box', label: 'Box' },
  { value: 'icosahedron', label: 'Icosahedron' },
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
  const [tagsSel, setTagsSel] = useState<string[]>(['dynamic', 'shadow']);
  const [assets, setAssets] = useState<string[]>([]);
  return (
    <Section
      title="Select"
      note="Single or multi select with optional search and full keyboard support. loadOptions switches it to async search (debounced 250 ms; rejections render in the list — try the query 'error')."
      props={['SingleSelectProps', 'MultiSelectProps', 'SelectOption']}
      code={`function MeshTags() {
  const [shape, setShape] = useState<string | null>('knot');
  const [tags, setTags] = useState<string[]>([]);
  const [assets, setAssets] = useState<string[]>([]);
  return (
    <>
      <Select searchable options={shapeOptions}
        value={shape} onChange={setShape} />
      <Select multiple options={tagOptions}
        value={tags} onChange={setTags} placeholder="Add tags…" />
      <Select multiple loadOptions={searchAssets}
        value={assets} onChange={setAssets} />
    </>
  );
}`}
    >
      <label className="mb-1 block text-slate-400 text-xs">Single, searchable</label>
      <Select searchable options={shapeOptions} value={shape} onChange={setShape} />
      <label className="mt-3 mb-1 block text-slate-400 text-xs">Multi</label>
      <Select multiple options={tagOptions} value={tagsSel} onChange={setTagsSel} placeholder="Add tags…" />
      <label className="mt-3 mb-1 block text-slate-400 text-xs">Async search — try "rock", or "error"</label>
      <Select multiple loadOptions={searchAssets} value={assets} onChange={setAssets} placeholder="Search assets…" />
    </Section>
  );
}
