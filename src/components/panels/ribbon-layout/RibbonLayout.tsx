// Layout ribbon: 12 named dock-layout slots (F1-F12). Click a slot to select
// it and apply its saved layout (+ linked ribbon); Save stores the current
// layout into the selected slot. Names are edited in Settings → Layouts.
import { IconDeviceFloppy, IconLayoutDashboard } from '@tabler/icons-react';
import { usePanelContext } from '@treDeSpaceUI/dockable';
import { Ribbon, RibbonButton, RibbonSection, Select } from '@treDeSpaceUI/widgets';
import { layoutsActions as act, layoutsState } from '../../../state/layouts.state';

const isRibbon = (dockableIn?: string | string[]) =>
  dockableIn === 'top' || (Array.isArray(dockableIn) && dockableIn.includes('top'));

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
      {/* slots 1-9: one workspace per ribbon tab */}
      <RibbonSection title="Ribbon">{s.slots.slice(0, 9).map(slotButton)}</RibbonSection>
      {/* slots 10-12: the task workspaces (Viewpoint, SQL Editor, Assets) */}
      <RibbonSection title="Misc">{s.slots.slice(9).map((slot, i) => slotButton(slot, i + 9))}</RibbonSection>

      <RibbonSection title="Override layouts">
        <RibbonButton
          size="big"
          icon={<IconDeviceFloppy />}
          label="Save"
          disabled={s.selected == null}
          tooltip="Save the current panel layout into the selected slot"
          shortcut="layout.save"
          onClick={() => act.saveCurrent()}
        />
        <div
          className="flex w-44 flex-col justify-center gap-1"
          data-tooltip="Ribbon tab focused when this slot's layout is applied"
        >
          <span className="text-slate-400 text-xs">Linked ribbon</span>
          <Select
            options={ribbonOptions}
            value={selected?.ribbon ?? ''}
            onChange={(v) => {
              if (s.selected != null) {
                act.setRibbon(s.selected, v || null);
              }
            }}
          />
          <label
            className="flex cursor-pointer items-center gap-1.5 text-slate-300 text-xs"
            data-tooltip="Show the ribbon strip when this slot's layout is applied (default on)"
          >
            <input
              type="checkbox"
              disabled={s.selected == null}
              checked={selected?.ribbonOpen !== false}
              onChange={(e) => {
                if (s.selected != null) {
                  act.setRibbonOpen(s.selected, e.target.checked);
                }
              }}
            />
            Ribbon open
          </label>
        </div>
      </RibbonSection>
    </Ribbon>
  );
}
