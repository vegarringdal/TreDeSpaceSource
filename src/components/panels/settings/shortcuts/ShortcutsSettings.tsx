import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { hotkeysActions, hotkeysState } from '@treDeSpaceUI/hotkeys';
import { Button, Collapsible, InfoButton } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
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
  const { recordingId, record, doExport, picker } = useShortcutsEditing();

  // group ids by category, preserving registration order
  const groups: { category: string; ids: string[] }[] = [];
  for (const id of order) {
    const cat = defs[id]?.category ?? 'Other';
    let g = groups.find((x) => x.category === cat);
    if (!g) {
      g = { category: cat, ids: [] };
      groups.push(g);
    }
    g.ids.push(id);
  }

  const anyCustom = Object.keys(overrides).length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <Collapsible title="Import / export" defaultOpen={false}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={doExport}>Export…</Button>
          <Button onClick={picker.open}>Import…</Button>
          <Button disabled={!anyCustom} onClick={() => hotkeysActions.resetAll()}>
            Reset all
          </Button>
          {picker.element}
        </div>
      </Collapsible>

      {groups.map(({ category, ids }) => {
        const isCollapsed = collapsed[category] ?? true; // collapsed by default
        const customCount = ids.filter((id) => id in overrides).length;
        return (
          <div key={category} className="border border-slate-800">
            <div className="flex w-full items-center gap-1 bg-slate-800 px-2 py-1 font-medium text-slate-200 text-xs hover:bg-slate-700">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                onClick={() => setCollapsed((c) => ({ ...c, [category]: !(c[category] ?? true) }))}
              >
                {isCollapsed ? (
                  <IconChevronRight size={14} className="shrink-0" />
                ) : (
                  <IconChevronDown size={14} className="shrink-0" />
                )}
                {category}
              </button>
              <span className="text-slate-500">{customCount > 0 ? `${customCount} custom` : `${ids.length}`}</span>
              <InfoButton>{SHORTCUTS_INFO}</InfoButton>
            </div>
            {!isCollapsed && (
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
            )}
          </div>
        );
      })}

      <CameraControlsSection />
    </div>
  );
}
