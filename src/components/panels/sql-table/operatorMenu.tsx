import { cn } from '@treDeSpaceUI/lib/cn';
import type { MenuEntry, MenuSeparator } from '@treDeSpaceUI/widgets';
import { type ColumnKind, type FilterOperator, OPERATOR_GROUPS, OPERATORS } from './filterOperators';

const RULE: MenuSeparator = { separator: true };

type OperatorLabelProps = Readonly<{ op: FilterOperator; isCurrent: boolean }>;

/** A menu entry's text: the button symbol in a fixed column, then the name —
 *  in the selected blue for the operator in use. */
function OperatorLabel({ op, isCurrent }: OperatorLabelProps) {
  const { symbol, label } = OPERATORS[op];

  return (
    <span className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-center font-mono text-[10px] text-slate-400">{symbol}</span>
      <span className={cn(isCurrent && 'font-medium text-blue-300')}>{label}</span>
    </span>
  );
}

/** The operator menu for one column kind, grouped as in OPERATOR_GROUPS. */
export function operatorMenuItems(
  kind: ColumnKind,
  current: FilterOperator,
  onPick: (op: FilterOperator) => void,
): MenuEntry[] {
  return OPERATOR_GROUPS[kind].flatMap((group, g) => [
    g > 0 && RULE,
    ...group.map((op) => ({
      id: op,
      label: <OperatorLabel op={op} isCurrent={op === current} />,
      onSelect: () => onPick(op),
    })),
  ]);
}
