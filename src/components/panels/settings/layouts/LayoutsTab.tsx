import { IconRotate } from '@tabler/icons-react';
import { Button, Collapsible, TextInput } from '@treDeSpaceUI/widgets';
import {
  isDefaultLayoutSlot,
  layoutSlotKeyLabel,
  layoutsActions,
  layoutsState,
  TOTAL_LAYOUT_SLOTS,
} from '../../../../state/layouts.state';
import { dialogs } from '../../../dialogs/dialogs.actions';

/** Settings → Layouts tab: names + resets for the 24 layout slots. The
 *  default slots (F1-F12) show their fixed name; the user slots (CTRL+F1-F12)
 *  are renamed here. */
export function LayoutsTab() {
  const layoutSlots = layoutsState.use().slots;

  return (
    <Collapsible
      title="Layout slot names"
      info={
        <>
          Names for the {TOTAL_LAYOUT_SLOTS} layout slots in the <b>App Layout</b> ribbon. The default layouts (F1–F12)
          keep their names; your own (CTRL+F1–F12) are named here. Select a slot in the ribbon and press Save to store
          the current panel layout in it.
        </>
      }
    >
      {layoutSlots.map((slot, i) => (
        <div key={layoutSlotKeyLabel(i)} className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-slate-400 text-xs">{layoutSlotKeyLabel(i)}</span>
          {/* grows with the panel width, capped at 2× the standard field */}
          <div className="min-w-0 max-w-56 grow basis-28">
            <TextInput
              value={slot.name}
              disabled={isDefaultLayoutSlot(i)}
              tooltip={
                isDefaultLayoutSlot(i)
                  ? 'A default app layout (F1-F12) keeps its name. Your own layouts (CTRL+F1-F12) can be renamed'
                  : 'Name of this layout, as its button in the App Layout ribbon shows it'
              }
              onChange={(v) => layoutsActions.rename(i, v)}
            />
          </div>
          {/* always shown; enabled only when the user has saved their
              own layout into this slot (nothing to reset otherwise) */}
          <Button
            iconOnly
            icon={<IconRotate size={14} />}
            disabled={!slot.custom}
            tooltip={
              isDefaultLayoutSlot(i)
                ? 'Reset this slot to its default layout'
                : 'Reset this slot (name + layout) to its default'
            }
            onClick={() => layoutsActions.resetOne(i)}
          />
        </div>
      ))}
      <Button
        className="mt-1 self-start"
        tooltip="Clear every saved layout snapshot and restore the default slot names (not touched by Reset all settings)"
        shortcut="layouts.reset"
        onClick={() =>
          void dialogs
            .confirm(
              `Reset all ${TOTAL_LAYOUT_SLOTS} layout slots? Saved layouts are cleared and names restored to defaults.`,
              {
                okLabel: 'Reset layouts',
              },
            )
            .then((ok) => ok && layoutsActions.resetAll())
        }
      >
        Reset layouts
      </Button>
    </Collapsible>
  );
}
