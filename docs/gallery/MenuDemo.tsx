import { IconCopy } from '@tabler/icons-react';
import { Menu, type MenuEntry } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

/** Gallery section for Menu. */
export function MenuDemo() {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [last, setLast] = useState('');
  const [hasSelection, setHasSelection] = useState(false);

  const items: MenuEntry[] = [
    { id: 'copy', label: 'Copy name', icon: <IconCopy />, onSelect: () => setLast('Copy name') },
    {
      id: 'copySel',
      label: 'Copy selected',
      disabled: !hasSelection,
      tooltip: 'Only the selected rows',
      onSelect: () => setLast('Copy selected'),
    },
    { separator: true },
    { id: 'remove', label: 'Remove file', danger: true, onSelect: () => setLast('Remove file') },
  ];

  return (
    <Section
      title="Menu"
      note="The right-click menu, portaled to the body so panel scroll clipping can never cut it off. It opens at the press position and is then measured and nudged back inside the viewport — no size guesses. Entries take a tooltip, a hotkey id, disabled and danger — an entry's tooltip opens beside the menu, never over the entries below it; `{ separator: true }` rules a group off, and a falsy entry is skipped so a conditional item can be written inline."
      props={['MenuProps', 'MenuItem']}
      code={`function RowMenu({ row }) {
  const [anchor, setAnchor] = useState(null);
  return (
    <>
      <div onContextMenu={(e) => { e.preventDefault(); setAnchor({ x: e.clientX, y: e.clientY }); }}>
        {row.name}
      </div>
      <Menu
        anchor={anchor}
        onClose={() => setAnchor(null)}
        items={[
          { id: 'copy', label: 'Copy name', onSelect: () => copy(row.name) },
          { separator: true },
          { id: 'del', label: 'Remove', danger: true, onSelect: () => remove(row) },
        ]}
      />
    </>
  );
}`}
    >
      <button
        type="button"
        className="flex h-24 w-full cursor-context-menu items-center justify-center border border-slate-700 border-dashed bg-slate-900 text-slate-400"
        onContextMenu={(e) => {
          e.preventDefault();
          setAnchor({ x: e.clientX, y: e.clientY });
        }}
        onClick={() => setHasSelection((v) => !v)}
      >
        Right-click here (click toggles the "has selection" state)
      </button>
      <Menu anchor={anchor} items={items} onClose={() => setAnchor(null)} />
      <div className="mt-2 text-slate-400">
        selection: {hasSelection ? 'yes' : 'no'}
        {last && ` · picked: ${last}`}
      </div>
    </Section>
  );
}
