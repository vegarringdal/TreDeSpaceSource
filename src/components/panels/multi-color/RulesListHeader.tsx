import { IconChevronsDown, IconChevronsUp, IconPlayerPlay, IconPlus, IconSelectAll } from '@tabler/icons-react';
import { Button, Select } from '@treDeSpaceUI/widgets';
import { useContext } from 'react';
import { COLOR_RULES_MODE_OPTIONS, COLOR_RULES_MODE_TOOLTIP } from './colorRulesModes';
import type { ColorRulesMode } from './multiColor.state';
import { MultiColorCtx } from './multiColorContext';

/** The header above the rule list: Run / Select / + Rule with Expand all /
 *  Collapse all for the rule sections on the right, then the run mode. The
 *  button row wraps in a narrow panel. */
export function RulesListHeader() {
  const { store, act } = useContext(MultiColorCtx);
  const s = store.use();
  const isEmpty = s.rules.length === 0;
  const canRun = !s.running && s.rules.some((r) => r.enabled);

  const handleModeChange = (mode: ColorRulesMode | null): void => {
    if (mode) {
      act.setMode(mode);
    }
  };

  return (
    <div className="mb-2 flex shrink-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          icon={<IconPlayerPlay size={14} />}
          disabled={!canRun}
          tooltip="Run all enabled rules in order"
          shortcut="multiColor.run"
          onClick={() => void act.run()}
        >
          Run
        </Button>
        <Button
          icon={<IconSelectAll size={14} />}
          disabled={!canRun}
          tooltip="Select every item the enabled rules match — the rules as a search: nothing is coloured and the run mode is ignored"
          shortcut="multiColor.select"
          onClick={() => void act.select()}
        >
          Select
        </Button>
        <Button
          icon={<IconPlus size={14} />}
          tooltip="Add a new rule to the end of the sequence"
          shortcut="multiColor.addRule"
          onClick={act.addRule}
        >
          Rule
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
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
      </div>
      <Select
        className="min-w-0"
        tooltip={COLOR_RULES_MODE_TOOLTIP}
        options={COLOR_RULES_MODE_OPTIONS}
        value={s.mode}
        onChange={handleModeChange}
      />
    </div>
  );
}
