import { IconArrowDown, IconArrowUp, IconPlus, IconRowInsertTop, IconTrash } from '@tabler/icons-react';
import {
  Button,
  Collapsible,
  ColorSelect,
  NumberInput,
  SegmentedControl,
  Select,
  TextInput,
} from '@treDeSpaceUI/widgets';
import { useContext } from 'react';
import { useLoadedStores } from '../../../state/viewer/storeScope';
import { FilterRowEditor } from './FilterRowEditor';
import type { ColorRule } from './multiColor.state';
import { MultiColorCtx } from './multiColorContext';

const COLOR_OPTIONS = [
  { value: 'default', label: 'Default', tooltip: 'Restore the original mesh color' },
  { value: 'custom', label: 'Custom', tooltip: 'Apply the picked color' },
] as const;

/** First custom colour a rule gets when switched off Default. */
const DEFAULT_RULE_COLOR = '#ff8800';

/** One color rule: a collapsible section with insert-before / move / enable /
 *  delete in its header, then name, color + opacity, store and filter rows. */
export function RuleEditor({
  idx,
  rule,
  count,
  total,
  collapsed,
}: {
  idx: number;
  rule: ColorRule;
  count: number | null;
  total: number;
  collapsed: boolean;
}) {
  const { act } = useContext(MultiColorCtx);
  const loadedStores = useLoadedStores();
  const storeOptions = [
    { value: '', label: 'All stores' },
    // only stores with models in the scene; keep a rule file's pick
    // selectable even when that store isn't loaded (it matches nothing)
    ...loadedStores.map((s) => ({ value: s, label: s })),
    ...(rule.store && !loadedStores.includes(rule.store) ? [{ value: rule.store, label: rule.store }] : []),
  ];

  const actions = (
    <>
      <Button
        iconOnly
        size="sm"
        icon={<IconRowInsertTop size={13} />}
        tooltip="Insert a new rule BEFORE this one"
        onClick={() => act.insertRuleBefore(idx)}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconArrowUp size={13} />}
        disabled={idx === 0}
        tooltip="Move this rule up (rules run top to bottom)"
        onClick={() => act.moveRule(idx, -1)}
      />
      <Button
        iconOnly
        size="sm"
        icon={<IconArrowDown size={13} />}
        disabled={idx === total - 1}
        tooltip="Move this rule down (rules run top to bottom)"
        onClick={() => act.moveRule(idx, 1)}
      />
      <Button
        size="sm"
        active={rule.enabled}
        tooltip="Enable / disable this rule — disabled rules are skipped by Run"
        onClick={() => act.toggleRule(idx)}
      >
        {rule.enabled ? 'On' : 'Off'}
      </Button>
    </>
  );

  return (
    <Collapsible
      title={
        <span className={rule.enabled ? undefined : 'text-red-400'}>
          #{idx + 1} {rule.comment || 'Rule'}
          {rule.enabled ? '' : ' — disabled'}
        </span>
      }
      aside={count != null ? `${count} matched` : undefined}
      actions={actions}
      open={!collapsed}
      onToggle={() => act.toggleCollapsed(idx)}
    >
      {/* delete lives down here, not in the header, so a header click can't hit it by mistake */}
      <div className="flex items-center gap-1">
        <TextInput
          className="min-w-0 flex-1"
          value={rule.comment}
          placeholder="Rule Name"
          onChange={(v) => act.updateRule(idx, { comment: v })}
        />
        <Button
          iconOnly
          icon={<IconTrash size={14} />}
          tooltip="Delete this rule"
          onClick={() => act.removeRule(idx)}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-neutral-400 text-xs">Color</span>
        <SegmentedControl
          className="w-40 shrink-0"
          grow
          options={COLOR_OPTIONS}
          value={rule.color == null ? 'default' : 'custom'}
          onChange={(v) => act.updateRule(idx, { color: v === 'default' ? null : (rule.color ?? DEFAULT_RULE_COLOR) })}
        />
        {rule.color != null && (
          <div className="min-w-0 flex-1">
            <ColorSelect value={rule.color} onChange={(c) => act.updateRule(idx, { color: c })} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-neutral-400 text-xs">Opacity</span>
        <div className="w-40">
          <NumberInput
            value={rule.opacity}
            min={0}
            max={1}
            step={0.05}
            precision={2}
            onChange={(v) => act.updateRule(idx, { opacity: v })}
          />
        </div>
        <Button
          active={rule.opacity === 0}
          tooltip="Quick set: opacity 0 — matched items are hidden. This sets the hide flag rather than a 0 % override; move the rule off 0 and its items come back on the next run"
          onClick={() => act.updateRule(idx, { opacity: 0 })}
        >
          0
        </Button>
        <Button
          active={rule.opacity === 1}
          tooltip="Quick set: opacity 1 — fully opaque (default)"
          onClick={() => act.updateRule(idx, { opacity: 1 })}
        >
          1
        </Button>
        {rule.opacity === 1 && <span className="text-neutral-500 text-xs">opaque</span>}
        {rule.opacity === 0 && <span className="text-neutral-500 text-xs">hidden</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-14 shrink-0 text-neutral-400 text-xs">Store</span>
        <Select
          className="w-40 shrink-0"
          tooltip="Scope this rule to models loaded from one store — All stores matches every loaded model"
          options={storeOptions}
          value={rule.store}
          onChange={(v) => act.updateRule(idx, { store: v ?? '' })}
        />
        {rule.store !== '' && <span className="text-neutral-500 text-xs">only models from this store</span>}
      </div>

      {rule.filters.map((row, j) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
        <FilterRowEditor key={j} ruleIdx={idx} idx={j} total={rule.filters.length} row={row} />
      ))}
      <Button icon={<IconPlus size={14} />} tooltip="Add a filter row to this rule" onClick={() => act.addFilter(idx)}>
        Add filter
      </Button>
    </Collapsible>
  );
}
