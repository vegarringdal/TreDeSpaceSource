import { formatSequence, hotkeysActions, hotkeysState } from '@treDeSpaceUI/hotkeys';
import { Badge, Button, Collapsible, EmptyState, TextInput } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { SettingsSection } from '../SettingsSection';
import { CameraControlsSection } from './CameraControlsSection';
import { ShortcutRow } from './ShortcutRow';
import { useShortcutsEditing } from './useShortcutsEditing';

/** The one explanation shown behind the info icon on every shortcut category. */
const SHORTCUTS_INFO = (
  <>
    Global keyboard shortcuts. Click Record and press the keys — <b>&amp;</b> = together, then release for the next
    step. Edits are saved locally.
  </>
);

/** Settings → Shortcuts: every hotkey grouped in a collapsible panel per
 *  category, with record / reset / reset-all and JSON export / import. */
export function ShortcutsSettings() {
  const { defs, order, overrides } = hotkeysState.use();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const { recordingId, record, doExport, picker } = useShortcutsEditing();

  // search across everything a user might remember a shortcut by: its label,
  // description, id, category and the combo it is currently bound to
  const needle = query.trim().toLowerCase();
  const matches = (id: string): boolean => {
    if (!needle) {
      return true;
    }
    const d = defs[id];
    const seq = hotkeysActions.sequenceFor(id);
    const hay = [id, d?.label, d?.description, d?.category, seq ? formatSequence(seq) : ''].join(' ').toLowerCase();
    return hay.includes(needle);
  };

  // group ids by category, preserving registration order; while searching,
  // only matching rows are grouped and empty categories vanish
  const groups: { category: string; ids: string[] }[] = [];
  for (const id of order) {
    if (!matches(id)) {
      continue;
    }
    const cat = defs[id]?.category ?? 'Other';
    let g = groups.find((x) => x.category === cat);
    if (!g) {
      g = { category: cat, ids: [] };
      groups.push(g);
    }
    g.ids.push(id);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <SettingsSection
        id="shortcuts"
        title="Import / export"
        defaultOpen={false}
        info={
          <>
            Share a keymap: Export writes only your custom bindings to JSON, Import applies such a file (unknown or
            conflicting bindings are skipped). The header reset drops every custom binding.
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button onClick={doExport}>Export…</Button>
          <Button onClick={picker.open}>Import…</Button>
          {picker.element}
        </div>
      </SettingsSection>

      <TextInput
        type="search"
        value={query}
        onChange={setQuery}
        placeholder="Search shortcuts — name, description, key combo (e.g. END, ALT + 6)…"
      />
      {needle && groups.length === 0 && <EmptyState>No shortcut matches “{query}”.</EmptyState>}

      {groups.map(({ category, ids }) => {
        // collapsed by default; a search opens every group that has a hit
        const isCollapsed = needle ? false : (collapsed[category] ?? true);
        const customCount = ids.filter((id) => id in overrides).length;
        return (
          <Collapsible
            key={category}
            title={category}
            open={!isCollapsed}
            onToggle={(next) => setCollapsed((c) => ({ ...c, [category]: !next }))}
            aside={customCount > 0 ? <Badge tone="warning">{customCount} custom</Badge> : <Badge>{ids.length}</Badge>}
            info={SHORTCUTS_INFO}
            bodyClassName="gap-0 p-0"
          >
            <div className="flex flex-col divide-y divide-slate-800">
              {ids.map((id) => (
                <ShortcutRow
                  key={id}
                  id={id}
                  def={defs[id]}
                  custom={id in overrides}
                  recording={recordingId === id}
                  onRecord={(x) => void record(x)}
                />
              ))}
            </div>
          </Collapsible>
        );
      })}

      <CameraControlsSection />
    </div>
  );
}
