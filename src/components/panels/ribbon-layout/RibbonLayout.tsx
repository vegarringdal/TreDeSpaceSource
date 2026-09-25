// App Layout ribbon: 12 preset dock-layout slots (F1-F12) and 12 user slots
// (Config01-12, ALT+F1-F12). Click a slot to select it and apply its saved
// layout (+ linked ribbon); Save stores the current layout into the selected
// slot. Names are edited in Settings → Layouts.
import { IconDeviceFloppy, IconLayoutDashboard } from '@tabler/icons-react';
import { usePanelContext } from '@treDeSpaceUI/dockable';
import { Ribbon, RibbonButton, RibbonSection, SegmentedControl, Select } from '@treDeSpaceUI/widgets';
import { layoutsActions as act, LAYOUT_SLOTS, layoutsState } from '../../../state/layouts.state';

const isRibbon = (dockableIn?: string | string[]) =>
  dockableIn === 'top' || (Array.isArray(dockableIn) && dockableIn.includes('top'));

const RIBBON_OPEN_OPTIONS = [
  {
    value: 'open',
    label: 'Ribbon Open',
    tooltip: "Show the ribbon strip when this slot's layout is applied (default)",
  },
  { value: 'closed', label: 'Ribbon Closed', tooltip: "Collapse the ribbon strip when this slot's layout is applied" },
] as const;

export function RibbonLayout() {
  const { manager } = usePanelContext();
  const s = layoutsState.use();
  const selected = s.selected != null ? s.slots[s.selected] : null;
  const ribbonOptions = [
    { value: '', label: '(keep current ribbon)' },
    ...manager
      .allDefs()
      .filter((d) => isRibbon(d.dockableIn))
      .map((d) => ({ value: d.id, label: d.title })),
  ];
  const slotButton = (slot: (typeof s.slots)[number], i: number) => (
    <RibbonButton
      key={slot.name + String(i)}
      size="mini"
      className="min-w-28"
      icon={<IconLayoutDashboard />}
      label={slot.name}
      selected={s.selected === i}
      tooltip={
        slot.layout
          ? `Apply layout "${slot.name}" (and select it as the Save target)`
          : `Select empty slot "${slot.name}" as the Save target`
      }
      shortcut={`layout.slot${i + 1}`}
      onClick={() => act.activate(i)}
    />
  );
  return (
    <Ribbon>
      {/* the 12 preset slots (F1-F12), mini buttons stack 3 per column */}
      <RibbonSection title="Configured App Layouts (Shortcut F1-F12)">
        {s.slots.slice(0, LAYOUT_SLOTS).map(slotButton)}
      </RibbonSection>
      {/* the 12 user slots (ALT+F1-F12) — empty until the user saves into them */}
      <RibbonSection title="Configured App Layout (ALT + F1-F12)">
        {s.slots.slice(LAYOUT_SLOTS).map((slot, i) => slotButton(slot, LAYOUT_SLOTS + i))}
      </RibbonSection>

      <RibbonSection title="Override Selected">
        <RibbonButton
          size="big"
          icon={<IconDeviceFloppy />}
          label="Save"
          disabled={s.selected == null}
          tooltip="Save the current panel layout into the selected slot"
          shortcut="layout.save"
          onClick={() => act.saveCurrent()}
        />
        <div className="flex w-44 flex-col justify-center gap-1">
          <Select
            label="Linked Ribbon"
            tooltip="Ribbon tab focused when this slot's layout is applied"
            options={ribbonOptions}
            value={selected?.ribbon ?? ''}
            onChange={(v) => {
              if (s.selected != null) {
                act.setRibbon(s.selected, v || null);
              }
            }}
          />
          <SegmentedControl
            grow
            options={RIBBON_OPEN_OPTIONS}
            disabled={s.selected == null}
            value={selected?.ribbonOpen === false ? 'closed' : 'open'}
            onChange={(v) => {
              if (s.selected != null) {
                act.setRibbonOpen(s.selected, v === 'open');
              }
            }}
          />
        </div>
      </RibbonSection>
    </Ribbon>
  );
}
