import { Button } from '@treDeSpaceUI/widgets';
import type { SelectionActionId, SelectionActions } from './selectionActions';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type TableSideMenuProps = Readonly<{
  actions: SelectionActions;
}>;

type ButtonSpec = Readonly<{
  id: SelectionActionId;
  label: string;
  tooltip: string;
}>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const WITH_SELECTION: readonly ButtonSpec[] = [
  {
    id: 'asSelection',
    label: 'As Selection',
    tooltip:
      'Select the selected rows in the viewer: every fullname becomes the selection (replaces the current one; colors untouched, fullname_color ignored)',
  },
  {
    id: 'asWhite',
    label: 'As White',
    tooltip: 'Everything white + the selected rows colored (fullname_color when the result has it, else yellow)',
  },
  {
    id: 'asHidden',
    label: 'As Hidden',
    tooltip:
      'Isolate the selected rows: they stay, colored (fullname_color, else yellow), everything else is hidden (Reset model in Set Color recovers)',
  },
  {
    id: 'asTransparent',
    label: 'As Transparent',
    tooltip:
      'Like As White, but the base coat is white at 10% opacity — the rest of the model stays faintly visible behind the colored rows',
  },
  {
    id: 'addSetColor',
    label: 'Add Set Color',
    tooltip:
      'Add the selected rows to the Set Color panel as one new Multi rule (yellow, per-row fullname_color kept). Nothing runs — press Run there.',
  },
];

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** The SQL Table's left side menu: the "With selection" buttons, acting on the
 *  selected rows as shown. Off (with the reason under them) until the result
 *  has a fullname column and rows are selected. */
export function TableSideMenu({ actions }: TableSideMenuProps) {
  const isDisabled = actions.disabledReason !== null;

  return (
    <div className="flex w-36 shrink-0 flex-col gap-1.5 overflow-y-auto border-slate-800 border-r p-1.5 text-xs">
      <span className="text-slate-400">With selection</span>
      {WITH_SELECTION.map((spec) => (
        <Button
          key={spec.id}
          size="sm"
          disabled={isDisabled}
          shortcut={`sql.table.${spec.id}`}
          tooltip={spec.tooltip}
          onClick={actions[spec.id]}
        >
          {spec.label}
        </Button>
      ))}
      {actions.disabledReason && <span className="text-slate-500">{actions.disabledReason}</span>}
    </div>
  );
}
