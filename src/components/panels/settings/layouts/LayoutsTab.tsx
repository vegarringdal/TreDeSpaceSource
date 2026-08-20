import { IconRotate } from '@tabler/icons-react';
import { Button, Collapsible, TextInput } from '@treDeSpaceUI/widgets';
import { layoutsActions, layoutsState } from '../../../../state/layouts.state';
import { dialogs } from '../../../dialogs/dialogs.actions';

/** Settings → Layouts tab: names + resets for the 12 F-key layout slots. */
export function LayoutsTab() {
  const layoutSlots = layoutsState.use().slots;

  return (
    <Collapsible
      title="Layout slot names"
      info={
        <>
          Names for the 12 layout slots in the <b>Layout</b> ribbon (shortcuts F1–F12). Select a slot there and press
          Save to store the current panel layout in it.
        </>
      }
    >
      {layoutSlots.map((slot, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 12 fixed slots, never reordered
        <div key={`F${i + 1}`} className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-slate-400 text-xs">{`F${i + 1}`}</span>
          {/* grows with the panel width, capped at 2× the standard field */}
          <div className="min-w-0 max-w-56 grow basis-28">
            <TextInput value={slot.name} onChange={(v) => layoutsActions.rename(i, v)} />
          </div>
          {/* always shown; enabled only when the user has saved their
              own layout into this slot (nothing to reset otherwise) */}
          <Button
            iconOnly
            icon={<IconRotate size={14} />}
            disabled={!slot.custom}
            tooltip="Reset this slot (name + layout) to its default"
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
            .confirm('Reset all 12 layout slots? Saved layouts are cleared and names restored to defaults.', {
              okLabel: 'Reset layouts',
            })
            .then((ok) => ok && layoutsActions.resetAll())
        }
      >
        Reset layouts
      </Button>
    </Collapsible>
  );
}
