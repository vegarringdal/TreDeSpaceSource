import { IconCopy } from '@tabler/icons-react';
import { Menu, type MenuEntry } from '@treDeSpaceUI/widgets';
import { type KeyboardEvent, useState } from 'react';
import { Section } from './Section';

type PickMode = 'equals' | 'contains' | 'begins with';

const PICK_MODES: readonly PickMode[] = ['equals', 'contains', 'begins with'];

/** Gallery section for Menu. */
export function MenuDemo() {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [pickAnchor, setPickAnchor] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<PickMode>('equals');
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

  const pickItems: MenuEntry[] = PICK_MODES.map((m) => ({
    id: m,
    label: m === mode ? <span className="text-blue-300">{m}</span> : m,
    onSelect: () => setMode(m),
  }));

  const openPicker = (el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    setPickAnchor({ x: r.left, y: r.bottom + 2 });
  };

  const handlePickerKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      openPicker(e.currentTarget);
    }
  };

  return (
    <Section
      title="Menu"
      note="The right-click menu, portaled to the body so panel scroll clipping can never cut it off. It opens at the press position and is then measured and nudged back inside the viewport — no size guesses. Entries take a tooltip, a hotkey id, disabled and danger — an entry's tooltip opens beside the menu, never over the entries below it; `{ separator: true }` rules a group off, and a falsy entry is skipped so a conditional item can be written inline. ↑ / ↓ move between entries while focus is in the menu; `focusId` focuses an entry on open (for a menu opened from a key) and Escape or a pick hands focus back."
      props={['MenuProps', 'MenuItem']}
      code={`type Row = { name: string; hasSelection: boolean };

// copy / rename / copySelected / remove are yours
function RowMenu({ row, canRename }: { row: Row; canRename: boolean }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <div onContextMenu={(e) => { e.preventDefault(); setAnchor({ x: e.clientX, y: e.clientY }); }}>
        {row.name}
      </div>
      <Menu
        anchor={anchor}
        onClose={() => setAnchor(null)}
        items={[
          { id: 'copy', label: 'Copy name', icon: <IconCopy />, shortcut: 'rows.copyName', onSelect: () => copy(row.name) },
          canRename && { id: 'rename', label: 'Rename…', onSelect: () => rename(row) },
          { id: 'copySel', label: 'Copy selected', disabled: !row.hasSelection,
            tooltip: 'Only the selected rows', onSelect: copySelected },
          { separator: true },
          { id: 'del', label: 'Remove', danger: true, onSelect: () => remove(row) },
        ]}
      />
    </>
  );
}

// opened from a key: focus the current choice, hand focus back after
<Menu anchor={pickAnchor} focusId={mode} onClose={() => setPickAnchor(null)}
  items={MODES.map((m) => ({ id: m, label: m, onSelect: () => setMode(m) }))} />`}
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
      <input
        className="mt-3 h-6 w-full border border-slate-700 bg-slate-950 px-1.5 text-slate-200 outline-none focus:border-blue-400"
        placeholder={`Type here, Alt+↓ picks the mode (now: ${mode})`}
        onKeyDown={handlePickerKeyDown}
      />
      <Menu anchor={pickAnchor} items={pickItems} focusId={mode} onClose={() => setPickAnchor(null)} />
      <div className="mt-2 text-slate-400">
        selection: {hasSelection ? 'yes' : 'no'}
        {last && ` · picked: ${last}`}
      </div>
    </Section>
  );
}
