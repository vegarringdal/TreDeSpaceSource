import { IconChevronsDown, IconChevronsUp } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { useContext } from 'react';
import { MultiColorCtx } from './multiColorContext';

/** The row above the rule list: Expand all / Collapse all for the rule
 *  sections — the same header the SQL editor's filters have. */
export function RulesListHeader() {
  const { store, act } = useContext(MultiColorCtx);
  const isEmpty = store.use().rules.length === 0;

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="flex-1 text-neutral-400 text-xs">Rules</span>
      <Button
        iconOnly
        icon={<IconChevronsDown size={14} />}
        disabled={isEmpty}
        shortcut="multiColor.expandAll"
        tooltip="Expand all rules"
        onClick={act.expandAll}
      />
      <Button
        iconOnly
        icon={<IconChevronsUp size={14} />}
        disabled={isEmpty}
        shortcut="multiColor.collapseAll"
        tooltip="Collapse all rules"
        onClick={act.collapseAll}
      />
    </div>
  );
}
